# Local spoken-interview testing can keep cost records without enforcing spending gates.
# Development uses this behavior automatically; ordinary queued AI work is independent.
module Interviews
  module LocalTesting
    def self.unmetered?
      Rails.env.development?
    end
  end
end
