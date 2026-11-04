# Asks Cloudflare Turnstile whether a one-time browser token proves a person is signing up.
# Fails closed: if Cloudflare can't answer, or production has no secret, sign-up is refused
# with a message to retry. Sends only the token, our secret and the client IP.
module Accounts
  class VerifyBotChallengeService < ApplicationService
    ENDPOINT = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    # Cloudflare's published always-pass test secret. It proves nothing, so production never uses it.
    NON_PRODUCTION_SECRET = "1x0000000000000000000000000000000AA"
    TEST_SECRETS = [ NON_PRODUCTION_SECRET, "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA" ].freeze
    MAX_TOKEN_BYTES = 2048
    FAILED = "Please complete the security check and try again."
    UNAVAILABLE = "We couldn't run the security check. Please try again in a moment."

    def initialize(token:, client_ip: nil)
      @token, @client_ip = token, client_ip
    end

    # @return [ServiceResult] success only when Cloudflare accepted this token. Tokens work once.
    def call
      return failure(FAILED) unless @token.is_a?(String) && @token.present? && @token.bytesize <= MAX_TOKEN_BYTES
      secret = configured_secret
      unless secret
        Rails.logger.error("Sign-up bot check has no valid TURNSTILE_SECRET_KEY")
        return failure(UNAVAILABLE)
      end

      response = Timeout.timeout(6) { post_to_cloudflare(secret) }
      return failure(UNAVAILABLE) unless response.code == "200"
      data = JSON.parse(response.body.to_s)
      return success if data.is_a?(Hash) && data["success"] == true
      # Secret errors land here too, so the codes are what reveal a misconfigured deployment.
      Rails.logger.warn("Sign-up bot check refused: #{Array(data.is_a?(Hash) ? data['error-codes'] : nil).join(', ')}")
      failure(FAILED)
    rescue JSON::ParserError, Timeout::Error, SocketError, SystemCallError, IOError, OpenSSL::SSL::SSLError, Net::HTTPBadResponse, Net::ProtocolError
      Rails.logger.warn("Sign-up bot check could not reach Cloudflare")
      failure(UNAVAILABLE)
    end

    private

    def configured_secret
      secret = ENV["TURNSTILE_SECRET_KEY"].presence
      if Rails.env.production?
        secret unless TEST_SECRETS.include?(secret)
      else
        secret || NON_PRODUCTION_SECRET
      end
    end

    def post_to_cloudflare(secret)
      uri = URI(ENDPOINT)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = true
      http.open_timeout = 2
      http.read_timeout = 3
      http.write_timeout = 2
      http.max_retries = 0
      request = Net::HTTP::Post.new(uri)
      request.set_form_data({ secret: secret, response: @token, remoteip: @client_ip }.compact)
      http.request(request)
    end
  end
end
