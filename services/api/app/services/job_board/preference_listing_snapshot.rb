# Build readable, immutable listing evidence and a digest of the complete source.
# Excerpts remain exact source text; a truncated snapshot never claims unseen details.
module JobBoard
  class PreferenceListingSnapshot
    MAX_TEXT_BYTES = 8_000
    PASSAGE_CHARACTERS = 500

    def initialize(listing)
      @listing = listing
    end

    def text
      payload = @listing.payload
      company = payload["company"].is_a?(Hash) ? payload.dig("company", "name") : nil
      remote = case payload["has_remote"]
      when true then "Provider lists a remote option; location restrictions or office days may apply."
      when false then "Provider lists no remote option."
      end
      values = { "Job" => payload["title"], "Company" => company, "Location" => payload["location"],
        "Remote arrangement" => payload["remote_type"], "Remote option" => remote, "Employment" => payload["employment_type"],
        "Salary" => payload["salary_text"], "Salary currency" => payload["salary_currency"],
        "Description" => ListingDescription.new(payload["description"].to_s).text }
      values.filter_map { |label, value| "#{label}: #{value}" if value.is_a?(String) && value.present? }.join("\n")
    end

    def digest = Digest::SHA256.hexdigest(text)

    def snapshot
      source = text
      excerpt = source.truncate_bytes(MAX_TEXT_BYTES, omission: "")
      pieces = excerpt.split("\n").reject(&:blank?).flat_map { |line| line.scan(/.{1,#{PASSAGE_CHARACTERS}}/m) }
      { "id" => @listing.id, "source_digest" => Digest::SHA256.hexdigest(source),
        "truncated" => excerpt != source || pieces.size > 64,
        "passages" => pieces.first(64).each_with_index.map { |piece, index| { "id" => "P#{index + 1}", "text" => piece } } }
    end
  end
end
