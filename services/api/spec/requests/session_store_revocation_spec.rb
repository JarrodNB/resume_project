# Exercise the standard store's public Rack interface with a deterministic in-flight
# request: logout deletes the row after load, then that old request attempts to write.
require "rails_helper"

RSpec.describe "Session store revocation", type: :request do
  it "authenticates Cable using the actual HTTP login cookie through session middleware" do
    user = create(:user)
    get "/auth/session"
    post "/auth/sign_in", params: { user: { email: user.email, password: "password123" } }, as: :json,
      headers: { "X-CSRF-Token" => response.parsed_body.fetch("csrfToken") }
    expect(response).to have_http_status(:ok)
    cookie = response.headers.fetch("Set-Cookie").split(";").first
    connected = nil
    endpoint = lambda do |env|
      connected = ApplicationCable::Connection.new(ActionCable.server, env)
      connected.connect
      [ 200, { "content-type" => "text/plain" }, [ "connected" ] ]
    end
    stack = ActionDispatch::Cookies.new(ActionDispatch::Session::ActiveRecordStore.new(endpoint, Rails.application.config.session_options))
    Rack::MockRequest.new(stack).get("/cable", Rails.application.env_config.merge("HTTP_COOKIE" => cookie))
    expect(connected.current_user).to eq(user)
    expect(connected.session_valid?).to be(true)
    sent = []
    allow(connected).to receive(:transmit) { |payload| sent << payload }
    live_channel = GraphqlChannel.new(connected, "private-updates")
    live_channel.transmit({ result: { data: "visible while signed in" } })
    expect(sent.last[:message]).to eq({ result: { data: "visible while signed in" } })
    ActiveRecord::SessionStore::Session.delete_all
    expect(connected.session_valid?).to be(false)
    live_channel.transmit({ result: { data: "must never arrive after logout" } })
    expect(sent.none? { |payload| payload[:message] == { result: { data: "must never arrive after logout" } } }).to be(true)
  end

  it "does not resurrect a deleted session when an already-loaded request commits" do
    user = create(:user)
    get "/auth/session"
    token = response.parsed_body.fetch("csrfToken")
    post "/auth/sign_in", params: { user: { email: user.email, password: "password123" } }, as: :json,
      headers: { "X-CSRF-Token" => token }
    expect(response).to have_http_status(:ok), response.body
    cookie = response.headers.fetch("Set-Cookie").split(";").first
    public_id = cookies["_careergrind_session"]
    sid = Rack::Session::SessionId.new(public_id)
    record = ActiveRecord::SessionStore::Session.find_by_session_id(sid.private_id)
    expect(record).to be_present
    endpoint = lambda do |env|
      loaded = env.fetch("rack.session")
      expect(loaded["warden.user.user.key"]).to be_present
      record.destroy!
      loaded["late_write"] = "after logout"
      [ 200, { "content-type" => "text/plain" }, [ "done" ] ]
    end
    stack = ActionDispatch::Cookies.new(ActionDispatch::Session::ActiveRecordStore.new(endpoint, Rails.application.config.session_options))
    Rack::MockRequest.new(stack).get("/late", "HTTP_COOKIE" => cookie)
    expect(BrowserSessions::ResolveSessionIdentityService.call(session_id: sid)).not_to be_success
    expect(ActiveRecord::SessionStore::Session.find_by_session_id(sid.private_id)).to be_nil
    expect(ActiveRecord::SessionStore::Session.all.none? { |row| row.data["warden.user.user.key"] }).to be(true)
  end
end
