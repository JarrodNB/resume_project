# Normalizes one provider listing before it enters the shared catalogue.
# Only confirmed US rows and allowed typed fields leave this module. It performs
# no requests or writes; missing optional values stay distinct from missing fields.
require "uri"
require_relative "listing_location"

module JobBoard
  module ListingPayload
    STRING_FIELDS = %w[description published remote_type expired_at employment_type salary_text salary_currency].freeze

    def self.safe_application_url(value)
      return unless value.is_a?(String)
      uri = URI.parse(value)
      value if %w[http https].include?(uri.scheme) && uri.host && !uri.userinfo
    rescue URI::InvalidURIError
      nil
    end

    def self.call(listing)
      return unless listing.is_a?(Hash) && valid_title?(listing["title"])
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

    def self.valid_title?(value)
      value.is_a?(String) && value.valid_encoding? && !value.strip.empty? && value.length <= 1000 && !value.match?(/[[:cntrl:]]/)
    end
    private_class_method :safe_application_url, :valid_title?
  end
end
