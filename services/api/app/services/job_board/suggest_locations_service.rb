# Resolve city/state names without exposing the provider key to the browser.
# Only confirmed US suggestions leave this boundary; no job search runs here.
require "net/http"
require "json"
require "timeout"

module JobBoard
  class SuggestLocationsService < ApplicationService
    ENDPOINT = "https://api.cleanjobdata.com/geo/suggest".freeze
    UNAVAILABLE = "Could not load locations. Please try again.".freeze

    def initialize(query:, api_key: ENV["CLEANJOBDATA_API_KEY"])
      @query, @api_key = query, api_key
    end

    def call
      return failure("Enter a city or state of 2 to 100 characters.") unless @query.is_a?(String) && @query.valid_encoding? && @query.strip.length.between?(2, 100) && !@query.match?(/[[:cntrl:]]/)
      return failure("CleanJobData is not configured.") unless @api_key.is_a?(String) && !@api_key.strip.empty?

      uri = URI(ENDPOINT)
      uri.query = URI.encode_www_form(q: @query.strip, kinds: "city,state", limit: 30)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.open_timeout = 2
      http.read_timeout = 3
      http.write_timeout = 2
      http.max_retries = 0
      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{@api_key}"
      request["Accept"] = "application/json"
      response = Timeout.timeout(5) { http.request(request) }
      return failure(UNAVAILABLE) unless response.code == "200"
      data = JSON.parse(response.body.to_s)
      return failure(UNAVAILABLE) unless data.is_a?(Array)

      locations = data.first(30).filter_map do |row|
        next unless row.is_a?(Hash) && row["country_code"] == "US" && %w[city state].include?(row["kind"])
        id = row["#{row['kind']}_id"]
        label = row["display_label"]
        next unless id.is_a?(Integer) && id.between?(1, 2_147_483_647) && label.is_a?(String) && label.valid_encoding? && label.strip.length.between?(1, 300)
        { kind: row["kind"], provider_id: id, label: label.strip }
      end.uniq { |row| [ row[:kind], row[:provider_id] ] }
      success(locations: locations, errors: [])
    rescue JSON::ParserError, Timeout::Error, SocketError, SystemCallError, IOError, OpenSSL::SSL::SSLError, Net::HTTPBadResponse, Net::ProtocolError
      failure(UNAVAILABLE)
    end
  end
end
