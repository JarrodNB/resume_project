# Bounds browser authentication and account email requests using Rails cache counters.
# Rails parses email keys exactly as controllers do, across body formats and query parameters.
# Throttled requests get a JSON 429 with Retry-After.
# AI task limits (budget, hourly, in flight) are separate: see AiUsage::CheckAiTaskAllowanceService.
# Client addresses ignore the client-settable Forwarded header, skip trusted proxies, and group
# IPv6 by /64 because one customer usually controls a whole /64.
# Index:
#   - RackAttackRequestKeys.client_ip: the address or IPv6 network that IP limits count against
#   - RackAttackRequestKeys.account_email: normalized email from accepted Rails parameters
#   - RackAttackRequestKeys.sign_up_mailbox: the email without its +tag, so tagged addresses share a limit
#   - RackAttackRequestKeys.session_user_id: user id from a valid persisted session
#   - throttles: auth/sign_in (IP, email), auth/sign_up (IP, mailbox), graphql (user, IP)
#   - throttled_responder: JSON 429 response
module RackAttackRequestKeys
  # Public proxy ranges, such as Cloudflare's, that sit in front of the app. Private ranges are
  # always trusted by Rack. Without this, every visitor behind one edge IP would share its limits.
  TRUSTED_PROXY_CIDRS = ENV.fetch("TRUSTED_PROXY_CIDRS", "").split(",").map(&:strip).reject(&:empty?).map { |cidr| IPAddr.new(cidr) }.freeze

  def self.trusted_proxy?(address)
    parsed = IPAddr.new(address)
    TRUSTED_PROXY_CIDRS.any? { |cidr| cidr.include?(parsed) }
  rescue ArgumentError
    false
  end

  # IPv4 counts per address, including IPv4 written in IPv6 form. IPv6 counts per /64.
  def self.client_ip(request)
    address = IPAddr.new(request.ip)
    return address.native.to_s unless address.ipv6? && !address.ipv4_mapped?
    "#{address.mask(64)}/64"
  rescue ArgumentError
    request.ip
  end

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

  def self.sign_up_mailbox(request)
    email = account_email(request)
    Accounts::SignUpEmailRules.mailbox(email) if email
  end

  # Use the same persisted session boundary as HTTP and Cable; IP limits still cover guests.
  def self.session_user_id(request)
    result = BrowserSessions::ResolveSessionIdentityService.call(session_id: request.session.id)
    result.value.id if result.success?
  end
end

# Forwarded is read before X-Forwarded-For by default, and proxies commonly pass it through
# unchanged, which would let a client pick a new address for every request.
Rack::Request.forwarded_priority = [ :x_forwarded ]
default_trusted_proxy_filter = Rack::Request.ip_filter
Rack::Request.ip_filter = lambda do |address|
  default_trusted_proxy_filter.call(address) || RackAttackRequestKeys.trusted_proxy?(address)
end

Rack::Attack.cache.store = Rails.cache

Rack::Attack.throttle("auth/session/ip", limit: 30, period: 1.minute) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/sessions#show"
end

Rack::Attack.throttle("auth/sign_in/ip", limit: 5, period: 20.seconds) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/sessions#create"
end

Rack::Attack.throttle("auth/sign_in/email", limit: 10, period: 10.minutes) do |request|
  RackAttackRequestKeys.account_email(request) if RackAttackRequestKeys.action(request) == "auth/sessions#create"
end

Rack::Attack.throttle("auth/sign_up/ip", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/registrations#create"
end

# Counts attempts whether or not an account exists, so hitting either limit reveals nothing.
Rack::Attack.throttle("auth/sign_up/mailbox/hour", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.sign_up_mailbox(request) if RackAttackRequestKeys.action(request) == "auth/registrations#create"
end

Rack::Attack.throttle("auth/sign_up/mailbox/day", limit: 10, period: 1.day) do |request|
  RackAttackRequestKeys.sign_up_mailbox(request) if RackAttackRequestKeys.action(request) == "auth/registrations#create"
end

Rack::Attack.throttle("auth/confirmation/ip", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/confirmations#create"
end

Rack::Attack.throttle("auth/confirmation/email", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.account_email(request) if RackAttackRequestKeys.action(request) == "auth/confirmations#create"
end

Rack::Attack.throttle("auth/confirmation/verify/ip", limit: 10, period: 1.minute) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/confirmations#verify"
end

Rack::Attack.throttle("auth/password/ip", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/passwords#create"
end

Rack::Attack.throttle("auth/password/email", limit: 5, period: 1.hour) do |request|
  RackAttackRequestKeys.account_email(request) if RackAttackRequestKeys.action(request) == "auth/passwords#create"
end

Rack::Attack.throttle("auth/password/reset/ip", limit: 10, period: 1.minute) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/passwords#update"
end

Rack::Attack.throttle("auth/password/change/ip", limit: 5, period: 10.minutes) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "auth/passwords#change"
end

Rack::Attack.throttle("auth/password/change/user", limit: 5, period: 10.minutes) do |request|
  RackAttackRequestKeys.session_user_id(request) if RackAttackRequestKeys.action(request) == "auth/passwords#change"
end

Rack::Attack.throttle("graphql/user", limit: 120, period: 1.minute) do |request|
  RackAttackRequestKeys.session_user_id(request) if RackAttackRequestKeys.action(request) == "graphql#execute"
end

Rack::Attack.throttle("graphql/ip", limit: 300, period: 1.minute) do |request|
  RackAttackRequestKeys.client_ip(request) if RackAttackRequestKeys.action(request) == "graphql#execute"
end

Rack::Attack.throttled_responder = lambda do |request|
  match_data = request.env["rack.attack.match_data"]
  retry_after = match_data[:period] - (match_data[:epoch_time] % match_data[:period])
  body = { errors: [ "Too many requests. Please try again in #{retry_after} seconds." ] }.to_json
  [ 429, { "content-type" => "application/json", "retry-after" => retry_after.to_s }, [ body ] ]
end
