# Compares a guide's execution-time fingerprint with the current saved description.
# Legacy completed guides can still derive a fingerprint from their old saved input.
require "digest"

module StudyGuides
  module DescriptionFingerprint
    def self.fingerprint(description)
      Digest::SHA256.hexdigest(description.to_s)
    end

    def self.source_fingerprint(task)
      value = task.result.is_a?(Hash) && task.result["source_description_fingerprint"]
      from_values(value, task.input["description"])
    end

    def self.from_values(value, legacy_source)
      return value if value.is_a?(String) && value.match?(/\A[0-9a-f]{64}\z/)
      fingerprint(legacy_source) if legacy_source.is_a?(String)
    end

    def self.task_out_of_date?(task, description:)
      source_fingerprint(task) != fingerprint(description)
    end
  end
end
