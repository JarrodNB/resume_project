# Fetch one US job-search page for the shared catalogue. This boundary owns provider
# authentication and validation; it never saves jobs or fetches individual details.
require "net/http"
require "json"
require "timeout"

module JobBoard
  class SearchCleanJobDataService < ApplicationService
    ENDPOINT = "https://api.cleanjobdata.com/jobs".freeze
    TRANSIENT_RATE_LIMIT = "Too many requests. Please slow down and retry.".freeze
    UNAVAILABLE = "CleanJobData is temporarily unavailable. Please retry.".freeze
    INVALID_PAGE = "CleanJobData returned an invalid search page.".freeze
    STRING_FIELDS = %w[description published remote_type expired_at].freeze

    # @param keyword [String] nonblank title/keyword search, at most 200 characters
    # @param remote_only [Boolean] require the provider's remote filter
    # @param cursor [String, nil] opaque token from the same search's previous page
    # @return [ServiceResult] {listings: Array<Hash>, next_cursor: String | nil}
    #   Listings keep provider field names, with only confirmed US locations and a
    #   display location derived from those rows. Optional fields remain missing/null.
    #   Failure messages are safe to show and never contain raw provider responses.
    def initialize(keyword:, api_key: ENV["CLEANJOBDATA_API_KEY"], remote_only: false, cursor: nil)
      @keyword, @api_key, @remote_only, @cursor = keyword, api_key, remote_only, cursor
    end

    def call
      return failure("Enter a keyword of 1 to 200 characters.") unless valid_text?(@keyword, 200)
      return failure("Invalid search filters.") unless [ true, false ].include?(@remote_only) && (@cursor.nil? || valid_text?(@cursor, 4096))
      return failure("CleanJobData is not configured.") unless valid_text?(@api_key, 4096)

      # The total deadline also bounds slow streaming reads across both attempts.
      Timeout.timeout(8) { fetch_page }
    rescue JSON::ParserError
      failure(INVALID_PAGE)
    rescue Timeout::Error, SocketError, SystemCallError, IOError, OpenSSL::SSL::SSLError, Net::HTTPBadResponse, Net::ProtocolError
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
          return failure("CleanJobData monthly quota is exhausted.") if message.is_a?(String) && message.start_with?("Monthly request limit of ")
          return failure("CleanJobData is busy. Please retry shortly.")
        end
        return failure(http_error(response.code))
      end
    end

    def build_request
      uri = URI(ENDPOINT)
      parameters = { title: @keyword.strip, country_id: "233", extra_fields: "description" }
      parameters[:remote] = "true" if @remote_only
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
      when "400" then "CleanJobData rejected this search."
      when "401" then "CleanJobData authentication failed."
      when "403" then "The CleanJobData plan does not allow API access."
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
      labels = locations.filter_map { |row| row["display_label"] if row["display_label"].is_a?(String) && !row["display_label"].strip.empty? }.uniq
      normalized["location"] = labels.join("; ") unless labels.empty?
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
