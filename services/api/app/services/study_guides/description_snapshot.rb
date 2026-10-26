# Compares the exact description used for a guide with the current saved description.
# Fingerprints let the reader update all loaded history entries without sending source text.
require "digest"

module StudyGuides
  module DescriptionSnapshot
    # @param description [String, nil] saved text, without trimming or case normalization
    # @return [String] opaque metadata for comparing an immutable source with current text
    def self.fingerprint(description)
      Digest::SHA256.hexdigest(description.to_s)
    end

    # @return [Boolean] missing source text never establishes a current guide
    def self.out_of_date?(source:, description:)
      !source.is_a?(String) || source != description
    end
  end
end
