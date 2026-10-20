# Chooses a location for a public listing or a new private import. Confirmed US
# labels and city/state fields take priority; original text fills country-only gaps.
module JobBoard
  class ListingLocation
    # @param payload [Hash] provider response or saved catalogue snapshot
    # @return [String, nil] ordered, deduplicated locations; no writes or provider calls
    def self.call(payload)
      rows = payload["locations"].is_a?(Array) ? payload["locations"] : []
      labels = rows.filter_map do |row|
        next unless row.is_a?(Hash) && row["country_code"] == "US"
        label = text(row["display_label"])
        city = text(row["city_name"])
        state = text(row["state_code"]) || text(row["state_name"])
        label || ([ city, state, "US" ].compact.join(", ") if city || state)
      end.uniq
      return labels.join("; ") unless labels.empty?

      text(payload["location"]) || ("US" if rows.any? { |row| row.is_a?(Hash) && row["country_code"] == "US" })
    end

    def self.text(value)
      value.strip if value.is_a?(String) && value.valid_encoding? && !value.strip.empty?
    end
    private_class_method :text
  end
end
