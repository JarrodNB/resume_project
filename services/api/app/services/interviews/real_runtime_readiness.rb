# Checks only the dedicated executor's safe readiness endpoint before new paid sessions.
# Existing sessions and recovery do not depend on this probe. Never follows redirects.
require "net/http"
require "timeout"

module Interviews
  module RealRuntimeReadiness
    def self.ready?
      uri = URI(ENV.fetch("INTERVIEW_REAL_RUNTIME_ORIGIN", "http://interview-real-runtime:8000"))
      return false unless %w[http https].include?(uri.scheme) && uri.host && !uri.userinfo &&
        [ nil, "", "/" ].include?(uri.path) && !uri.query && !uri.fragment
      return false if ENV["INTERVIEW_SERVICE_SECRET"].blank?

      uri.path = "/ready"
      request = Net::HTTP::Get.new(uri)
      request["Authorization"] = "Bearer #{ENV.fetch('INTERVIEW_SERVICE_SECRET')}"
      http = Net::HTTP.new(uri.host, uri.port, nil)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = http.read_timeout = http.write_timeout = 1
      Timeout.timeout(2) do
        http.start do |http|
          body = +""
          http.request(request) do |response|
            return false unless response.code == "200"
            response.read_body do |chunk|
              return false if body.bytesize + chunk.bytesize > 1024
              body << chunk
            end
          end
          JSON.parse(body)["ready"] == true
        end
      end
    rescue StandardError
      # Endpoint/configuration errors can contain capabilities or credentials.
      false
    end
  end
end
