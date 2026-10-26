# Admission switch for optional references. Disabling it never blocks an interview answer.
module Interviews
  module ReferencesPolicy
    def self.enabled?
      ENV["INTERVIEW_REFERENCES_ENABLED"] == "true"
    end
  end
end
