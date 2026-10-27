# Send an operation identity to the fixed AI origin after its database commit.
# A received HTTP202 is intentionally not a durable-delivery acknowledgement.
# Only the runtime's explicit busy response represents healthy capacity pressure.
require "net/http"
require "timeout"

module AiExecutions
  class NudgeService < ApplicationService
    def initialize(feature:, operation_id:)
      @feature, @operation_id = feature, operation_id
    end

    # @return [ServiceResult<Symbol>] :accepted or :busy, otherwise a transport failure
    def call
      uri = URI(ENV.fetch("AI_HTTP_ORIGIN", "http://ai-http:8000"))
      secret = ENV["INTERVIEW_SERVICE_SECRET"]
      return failure("AI execution unavailable") unless secret.present? &&
        %w[http https].include?(uri.scheme) && uri.host && !uri.userinfo &&
        [ nil, "", "/" ].include?(uri.path) && !uri.query && !uri.fragment

      uri.path = "/internal/executions"
      request = Net::HTTP::Post.new(uri)
      request["Authorization"] = "Bearer #{secret}"
      request["Content-Type"] = "application/json"
      request.body = JSON.generate(feature: @feature, operation_id: @operation_id)
      http = Net::HTTP.new(uri.host, uri.port, nil)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = http.write_timeout = 0.2
      http.read_timeout = 0.5
      Timeout.timeout(1) do
        http.start do |connection|
          connection.request(request) do |response|
            return failure("AI execution unavailable") unless %w[202 503].include?(response.code)
            body = +""
            response.read_body do |chunk|
              body << chunk
              return failure("AI execution unavailable") if body.bytesize > 1024
            end
            return success(:accepted) if response.code == "202"
            return success(:busy) if JSON.parse(body) == { "error" => "busy" }

            return failure("AI execution unavailable")
          end
        end
      end
    rescue StandardError
      # Transport exceptions may include credentials or URLs; return a fixed code.
      failure("AI execution unavailable")
    end
  end
end
