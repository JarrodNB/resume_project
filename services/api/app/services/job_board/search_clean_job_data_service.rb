# Fetch one US job-search page for the shared catalogue. This boundary owns provider
# authentication and validation; it never saves jobs or fetches individual details.
require "net/http"
require "json"
require "timeout"
require_relative "listing_location"
require_relative "experience_levels"
require_relative "search_filters"

module JobBoard
  class SearchCleanJobDataService < ApplicationService
    ENDPOINT = "https://api.cleanjobdata.com/jobs".freeze
    TRANSIENT_RATE_LIMIT = "Too many requests. Please slow down and retry.".freeze
    UNAVAILABLE = "Job search is temporarily unavailable. Please retry.".freeze
    INVALID_PAGE = "Job search returned an invalid page.".freeze
    STRING_FIELDS = %w[description published remote_type expired_at employment_type salary_text salary_currency].freeze

    # @param keyword [String] nonblank title/keyword search, at most 200 characters
    # @param remote_only [Boolean] require the provider's remote filter
    # @param experience_levels [Array<String>] provider codes; empty means all levels
    # @param filters [Hash] date, location, employment, remote type, salary, company and sort
    # @param cursor [String, nil] opaque token from the same search's previous page
    # @return [ServiceResult] {listings: Array<Hash>, next_cursor: String | nil}
    #   Listings keep provider field names, with only confirmed US locations and a
    #   display location preferring those rows, with original-text fallback.
    #   Optional fields remain missing/null.
    #   Failure messages are safe to show and never contain raw provider responses.
    def initialize(keyword:, api_key: ENV["CLEANJOBDATA_API_KEY"], remote_only: false, cursor: nil, experience_levels: [], filters: {})
      @keyword, @api_key, @remote_only, @cursor = keyword, api_key, remote_only, cursor
      @experience_levels = ExperienceLevels.normalize(experience_levels)
      @filters = SearchFilters.normalize(filters)
    end

    def call
      return failure("Enter a keyword of 1 to 200 characters.") unless valid_text?(@keyword, 200)
      return failure("Invalid search filters.") unless @filters && @experience_levels && [ true, false ].include?(@remote_only) && (@cursor.nil? || valid_text?(@cursor, 4096))
      return failure("Job search is not configured.") unless valid_text?(@api_key, 4096)

      # The total deadline also bounds slow streaming reads across both attempts.
      Timeout.timeout(8) { fetch_page }
    rescue JSON::ParserError
      failure(INVALID_PAGE)
    rescue Timeout::Error, SocketError, SystemCallError, IOError, OpenSSL::SSL::SSLError, Net::HTTPBadResponse, Net::ProtocolError => error
      Rails.logger.warn("CleanJobData search failed: #{error.class}")
      failure(UNAVAILABLE)
    end

    private

    def valid_text?(value, limit)
      value.is_a?(String) && value.valid_encoding? && !value.strip.empty? && value.length <= limit && !value.match?(/[[:cntrl:]]/)
    end

    def fetch_page
      http, request = build_request
      2.times do |attempt|
        response = http.request(request)
        return parse_page(JSON.parse(response.body.to_s)) if response.code == "200"

        if response.code == "429"
          message = JSON.parse(response.body.to_s)
          message = message["error"] if message.is_a?(Hash)
          if message == TRANSIENT_RATE_LIMIT && attempt.zero?
            sleep(1)
            next
          end
          return failure("Job search quota is exhausted.") if message.is_a?(String) && message.start_with?("Monthly request limit of ")
          return failure("Job search is busy. Please retry shortly.")
        end
        Rails.logger.warn("CleanJobData search failed: HTTP #{response.code}")
        return failure(http_error(response.code))
      end
    end

    def build_request
      uri = URI(ENDPOINT)
      parameters = { title: @keyword.strip, country_id: "233", extra_fields: "description" }
      parameters[:remote] = "true" if @remote_only
      parameters[:experience_level] = @experience_levels.join(",") if @experience_levels.any?
      parameters.merge!(SearchFilters.parameters(@filters))
      parameters[:remote] = "true" if @filters[:remote_type]
      parameters[:cursor] = @cursor if @cursor
      uri.query = URI.encode_www_form(parameters)
      # Ignore proxy environment variables; the host and HTTPS transport are fixed.
      http = Net::HTTP.new(uri.host, uri.port, nil)
      http.use_ssl = true
      http.open_timeout = 2
      http.read_timeout = 3
      http.write_timeout = 2
      http.max_retries = 0
      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{@api_key}"
      request["Accept"] = "application/json"
      [ http, request ]
    end

    def http_error(code)
      case code
      when "400" then "Job search rejected this search."
      when "401" then "Job search authentication failed."
      when "403" then "The job search plan does not allow API access."
      else UNAVAILABLE
      end
    end

    def parse_page(page)
      return failure(INVALID_PAGE) unless page.is_a?(Hash) && page["data"].is_a?(Array) && page["meta"].is_a?(Hash)
      pagination = page["pagination"]
      return failure(INVALID_PAGE) unless pagination.is_a?(Hash) && pagination["limit"].is_a?(Integer) && pagination["limit"].positive?
      cursor = pagination["next_page"]
      return failure(INVALID_PAGE) unless cursor.nil? || valid_text?(cursor, 4096)

      success(listings: page["data"].filter_map { |listing| normalize_listing(listing) }, next_cursor: cursor)
    end

    def safe_application_url(value)
      return unless value.is_a?(String)
      uri = URI.parse(value)
      value if %w[http https].include?(uri.scheme) && uri.host && !uri.userinfo
    rescue URI::InvalidURIError
      nil
    end

    def normalize_listing(listing)
      return unless listing.is_a?(Hash) && valid_text?(listing["title"], 1000)
      provider_id = if listing["id"].is_a?(Integer)
        listing["id"]
      elsif listing["id"].is_a?(String) && listing["id"].match?(/\A[0-9]+\z/)
        listing["id"].to_i
      end
      return unless provider_id&.positive?
      return unless listing["locations"].is_a?(Array)
      # Never infer country from free text or numeric IDs. A multi-country listing
      # qualifies when it has a resolved US row; only those US rows leave this boundary.
      locations = listing["locations"].select { |row| row.is_a?(Hash) && row["country_code"] == "US" }
      return if locations.empty?

      normalized = listing.slice("title").merge("id" => provider_id)
      normalized["locations"] = locations.map { |row| row.slice("country_code", "display_label", "city_name", "state_name", "state_code") }
      normalized["location"] = ListingLocation.call(listing)
      STRING_FIELDS.each { |key| normalized[key] = listing[key] if listing.key?(key) && (listing[key].nil? || listing[key].is_a?(String)) }
      %w[has_remote is_active].each { |key| normalized[key] = listing[key] if [ true, false ].include?(listing[key]) }
      normalized["application_url"] = safe_application_url(listing["application_url"]) if listing.key?("application_url")
      if listing["company"].is_a?(Hash)
        normalized["company"] = listing["company"].slice("name").select { |_key, value| value.nil? || value.is_a?(String) }
      elsif listing.key?("company") && listing["company"].nil?
        normalized["company"] = nil
      end
      normalized
    end
  end
end
