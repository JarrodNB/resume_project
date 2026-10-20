# Bounds browser authentication and account email requests using Rails cache counters.
# Rails parses email keys exactly as controllers do, across body formats and query parameters.
# Throttled requests get a JSON 429 with Retry-After.
# AI task limits (budget, hourly, in flight) are separate: see AiUsage::CheckAiTaskAllowanceService.
# Index:
#   - RackAttackRequestKeys.account_email: normalized email from accepted Rails parameters
#   - RackAttackRequestKeys.session_user_id: user id from a valid persisted session
#   - throttles: auth/sign_in (IP, email), auth/sign_up (IP), graphql (user, IP)
#   - throttled_responder: JSON 429 response
module RackAttackRequestKeys
  # Rails owns optional formats and method aliases. Cache only within this request.
  def self.action(request)
    request.env.fetch("careergrind.throttle_action") do
      rails_request = ActionDispatch::Request.new(request.env.dup)
      route = Rails.application.routes.recognize_path_with_request(rails_request, request.path_info, {})
      request.env["careergrind.throttle_action"] = "#{route[:controller]}##{route[:action]}"
    rescue ActionController::RoutingError
      request.env["careergrind.throttle_action"] = nil
    end
  end

  # Share Rails' parsing and query precedence instead of maintaining a second parser.
  def self.account_email(request)
    payload = ActionDispatch::Request.new(request.env).parameters
    return unless payload.is_a?(Hash) && payload["user"].is_a?(Hash)
    email = payload["user"]["email"]
    email.strip.downcase.presence if email.is_a?(String)
  rescue ActionDispatch::Http::Parameters::ParseError, ActionController::BadRequest, TypeError
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
  request.ip if RackAttackRequestKeys.action(request) == "auth/sessions#show"
end

Rack::Attack.throttle("auth/sign_in/ip", limit: 5, period: 20.seconds) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "auth/sessions#create"
end

Rack::Attack.throttle("auth/sign_in/email", limit: 10, period: 10.minutes) do |request|
  RackAttackRequestKeys.account_email(request) if RackAttackRequestKeys.action(request) == "auth/sessions#create"
end

Rack::Attack.throttle("auth/sign_up/ip", limit: 5, period: 1.hour) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "auth/registrations#create"
end

Rack::Attack.throttle("auth/confirmation/ip", limit: 5, period: 1.hour) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "auth/confirmations#create"
end

Rack::Attack.throttle("auth/confirmation/email", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.account_email(request) if RackAttackRequestKeys.action(request) == "auth/confirmations#create"
end

Rack::Attack.throttle("auth/confirmation/verify/ip", limit: 10, period: 1.minute) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "auth/confirmations#verify"
end

Rack::Attack.throttle("auth/password/ip", limit: 5, period: 1.hour) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "auth/passwords#create"
end

Rack::Attack.throttle("auth/password/email", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.account_email(request) if RackAttackRequestKeys.action(request) == "auth/passwords#create"
end

Rack::Attack.throttle("auth/password/reset/ip", limit: 10, period: 1.minute) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "auth/passwords#update"
end

Rack::Attack.throttle("auth/password/change/ip", limit: 5, period: 10.minutes) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "auth/passwords#change"
end

Rack::Attack.throttle("auth/password/change/user", limit: 5, period: 10.minutes) do |request|
  RackAttackRequestKeys.session_user_id(request) if RackAttackRequestKeys.action(request) == "auth/passwords#change"
end

Rack::Attack.throttle("graphql/user", limit: 120, period: 1.minute) do |request|
  RackAttackRequestKeys.session_user_id(request) if RackAttackRequestKeys.action(request) == "graphql#execute"
end

Rack::Attack.throttle("graphql/ip", limit: 300, period: 1.minute) do |request|
  request.ip if RackAttackRequestKeys.action(request) == "graphql#execute"
end

Rack::Attack.throttled_responder = lambda do |request|
  match_data = request.env["rack.attack.match_data"]
  retry_after = match_data[:period] - (match_data[:epoch_time] % match_data[:period])
  body = { errors: [ "Too many requests. Please try again in #{retry_after} seconds." ] }.to_json
  [ 429, { "content-type" => "application/json", "retry-after" => retry_after.to_s }, [ body ] ]
end
