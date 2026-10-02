# Description: Request throttling (Rack::Attack, counters in Rails.cache): sign-in and sign-up
# by IP and email, and GraphQL by user and IP. Throttled requests get a JSON 429 with Retry-After.
# AI task limits (budget, hourly, in flight) are separate: see AiUsage::CheckAiTaskAllowanceService.
# Index:
#   - RackAttackRequestKeys.sign_in_email: normalized email from a JSON sign-in body
#   - RackAttackRequestKeys.jwt_user_id: user id from a valid Bearer token
#   - throttles: auth/sign_in (IP, email), auth/sign_up (IP), graphql (user, IP)
#   - throttled_responder: JSON 429 response
module RackAttackRequestKeys
  # Returns the downcased email from a JSON sign-in body, or nil. Rewinds the body for Rails.
  def self.sign_in_email(request)
    body = request.body.read
    request.body.rewind
    JSON.parse(body).dig("user", "email").to_s.strip.downcase.presence
  rescue JSON::ParserError, TypeError
    nil
  end

  # Returns the user id from a valid, unexpired Bearer token, or nil (the IP throttle still
  # applies). Revocation isn't checked; this only picks a throttle bucket, it doesn't authenticate.
  def self.jwt_user_id(request)
    token = request.get_header("HTTP_AUTHORIZATION").to_s.delete_prefix("Bearer ").presence
    token && Warden::JWTAuth::TokenDecoder.new.call(token)["sub"]
  rescue JWT::DecodeError
    nil
  end
end

Rack::Attack.cache.store = Rails.cache

Rack::Attack.throttle("auth/sign_in/ip", limit: 5, period: 20.seconds) do |request|
  request.ip if request.post? && request.path == "/auth/sign_in"
end

Rack::Attack.throttle("auth/sign_in/email", limit: 10, period: 10.minutes) do |request|
  RackAttackRequestKeys.sign_in_email(request) if request.post? && request.path == "/auth/sign_in"
end

Rack::Attack.throttle("auth/sign_up/ip", limit: 5, period: 1.hour) do |request|
  request.ip if request.post? && request.path == "/auth/sign_up"
end

Rack::Attack.throttle("graphql/user", limit: 120, period: 1.minute) do |request|
  RackAttackRequestKeys.jwt_user_id(request) if request.post? && request.path == "/graphql"
end

Rack::Attack.throttle("graphql/ip", limit: 300, period: 1.minute) do |request|
  request.ip if request.post? && request.path == "/graphql"
end

Rack::Attack.throttled_responder = lambda do |request|
  match_data = request.env["rack.attack.match_data"]
  retry_after = match_data[:period] - (match_data[:epoch_time] % match_data[:period])
  body = { errors: [ "Too many requests. Please try again in #{retry_after} seconds." ] }.to_json
  [ 429, { "content-type" => "application/json", "retry-after" => retry_after.to_s }, [ body ] ]
end
