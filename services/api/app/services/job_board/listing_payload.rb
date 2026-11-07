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
      provider_id = parse_provider_id(listing["id"])
      return unless provider_id&.positive?
      locations = normalized_us_locations(listing["locations"])
      return if locations.empty?

      normalized = listing.slice("title").merge("id" => provider_id)
      normalized["locations"] = locations
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

    def self.parse_provider_id(value)
      if value.is_a?(Integer)
        value
      elsif value.is_a?(String) && value.match?(/\A[0-9]+\z/)
        value.to_i
      end
    end

    def self.normalized_us_locations(value)
      return [] unless value.is_a?(Array)

      # Never infer country from free text or numeric IDs. A multi-country listing
      # qualifies when it has a resolved US row; only those US rows leave this boundary.
      value.filter_map do |row|
        row.slice("country_code", "display_label", "city_name", "state_name", "state_code") if row.is_a?(Hash) && row["country_code"] == "US"
      end
    end
    private_class_method :safe_application_url, :valid_title?, :parse_provider_id, :normalized_us_locations
  end
end
