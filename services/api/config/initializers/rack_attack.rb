# Description: Request throttling (Rack::Attack, counters in Rails.cache): sign-in and sign-up
# by IP and email, and GraphQL by user and IP. Throttled requests get a JSON 429 with Retry-After.
# AI task limits (budget, hourly, in flight) are separate: see AiUsage::CheckAiTaskAllowanceService.
# Index:
#   - RackAttackRequestKeys.sign_in_email: normalized email from a JSON sign-in body
#   - RackAttackRequestKeys.session_user_id: user id from a valid persisted session
#   - throttles: auth/sign_in (IP, email), auth/sign_up (IP), graphql (user, IP)
#   - throttled_responder: JSON 429 response
module RackAttackRequestKeys
  # Returns the downcased email from a JSON sign-in body, or nil. Rewinds the body for Rails.
  def self.sign_in_email(request)
    body = request.body.read
    request.body.rewind
    payload = JSON.parse(body)
    return unless payload.is_a?(Hash) && payload["user"].is_a?(Hash)
    email = payload["user"]["email"]
    email.strip.downcase.presence if email.is_a?(String)
  rescue JSON::ParserError, TypeError
    nil
  end

  # Use the same persisted session boundary as HTTP and Cable; IP limits still cover guests.
  def self.session_user_id(request)
    result = BrowserSessions::ResolveSessionIdentityService.call(session_id: request.session.id)
    result.value.id if result.success?
  end
end

Rack::Attack.cache.store = Rails.cache

Rack::Attack.throttle("auth/session/ip", limit: 30, period: 1.minute) do |request|
  request.ip if request.get? && request.path == "/auth/session"
end

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
  RackAttackRequestKeys.session_user_id(request) if request.post? && request.path == "/graphql"
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
