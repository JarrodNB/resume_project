# Local spoken-interview testing can keep cost records without enforcing spending gates.
# This opt-in never applies outside development or to ordinary queued AI work.
module Interviews
  module LocalTesting
    def self.unmetered?
      Rails.env.development? && ENV["INTERVIEW_LOCAL_TESTING_UNMETERED"] == "true"
    end
  end
end
