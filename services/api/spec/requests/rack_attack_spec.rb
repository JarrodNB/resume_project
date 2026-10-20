# Exercises HTTP auth, email and session throttles with real in-memory counters.
# Equivalent request encodings must share limits; malformed input cannot bypass them.
require "rails_helper"

RSpec.describe "Rack::Attack throttling", type: :request do
  let(:json_headers) { { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json" } }

  # The test cache is a null store, so throttles never trip elsewhere; use a real one here.
  around do |example|
    original_store = Rack::Attack.cache.store
    Rack::Attack.cache.store = ActiveSupport::Cache::MemoryStore.new
    example.run
  ensure
    Rack::Attack.cache.store = original_store
  end

  # Posts a sign-in attempt from the given IP.
  def sign_in(email:, ip: "10.0.0.1")
    post "/auth/sign_in",
         params: { user: { email: email, password: "wrong-password" } }.to_json,
         headers: json_headers.merge("REMOTE_ADDR" => ip)
  end

  it "returns a JSON 429 with Retry-After after 5 sign-in attempts from one IP" do
    5.times { |attempt| sign_in(email: "user#{attempt}@example.com") }
    expect(response).to have_http_status(:unauthorized)

    sign_in(email: "another@example.com")

    expect(response).to have_http_status(:too_many_requests)
    expect(response.headers["retry-after"].to_i).to be_between(1, 20)
    expect(response.parsed_body["errors"].first).to start_with("Too many requests")
  end

  it "throttles sign-in attempts for one email across IPs" do
    10.times { |attempt| sign_in(email: "Target@Example.com ", ip: "10.0.1.#{attempt}") }

    sign_in(email: "target@example.com", ip: "10.0.2.1")

    expect(response).to have_http_status(:too_many_requests)
  end

  it "throttles GraphQL per signed-in user across routed JSON format aliases" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }.to_json, headers: json_headers
    auth_headers = json_headers

    120.times { |request_number| post(request_number.even? ? "/graphql" : "/graphql.json", params: { query: "{ me { email } }" }.to_json, headers: auth_headers) }
    expect(response).to have_http_status(:ok)

    post "/graphql.json", params: { query: "{ me { email } }" }.to_json, headers: auth_headers

    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds confirmation requests by IP, including malformed requests" do
    6.times { post "/auth/confirmation", params: { user: { email: "bad" } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
    expect(response.headers["retry-after"]).to be_present
    11.times { post "/auth/confirmation/verify", params: { confirmation_token: [] }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds confirmation email delivery across different IPs" do
    6.times do |n|
      post "/auth/confirmation", params: { user: { email: " Unknown@Example.com " } }, as: :json, headers: { "REMOTE_ADDR" => "10.9.0.#{n}" }
    end
    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds recovery mail, reset guessing and password change including malformed requests" do
    6.times { post "/auth/password", params: { user: { email: "bad" } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
    11.times { put "/auth/password", params: { user: { reset_password_token: [] } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
    6.times { patch "/auth/password/change", params: { user: { current_password: "bad" } }, as: :json }
    expect(response).to have_http_status(:too_many_requests)
  end

  it "bounds recovery delivery to one email across IPs" do
    6.times do |n|
      post "/auth/password", params: { user: { email: " Unknown@Example.com " } }, as: :json, headers: { "REMOTE_ADDR" => "10.8.0.#{n}" }
    end
    expect(response).to have_http_status(:too_many_requests)
  end

  [ "/auth/confirmation", "/auth/password" ].each do |endpoint|
    it "shares #{endpoint} mailbox limits across accepted encodings and query parameters" do
      account = build(:user, email: "mailbox@example.com", confirmed_at: endpoint == "/auth/confirmation" ? nil : Time.current)
      account.skip_confirmation_notification!
      account.save!
      query = Rack::Utils.build_nested_query(user: { email: account.email.upcase })
      boundary = "account-mail-throttle"
      multipart = "--#{boundary}\r\nContent-Disposition: form-data; name=\"user[email]\"\r\n\r\n#{account.email}\r\n--#{boundary}--\r\n"
      attempts = [
        [ endpoint, { params: { user: { email: account.email } }, as: :json } ],
        [ endpoint, { params: { user: { email: account.email } } } ],
        [ endpoint, { params: multipart, headers: { "CONTENT_TYPE" => "multipart/form-data; boundary=#{boundary}" } } ],
        [ "#{endpoint}?#{query}", { params: {}, as: :json } ],
        [ "#{endpoint}?#{query}", { params: { user: { email: "decoy@example.com" } }, as: :json } ]
      ]
      attempts.each_with_index do |(path, options), index|
        post path, **options.merge(headers: (options[:headers] || {}).merge("ACCEPT" => "application/json", "REMOTE_ADDR" => "10.7.0.#{index}"))
        expect(response).to have_http_status(:accepted)
      end
      persisted = account.reload.attributes
      post endpoint, params: { user: { email: account.email } }, headers: { "ACCEPT" => "application/json", "REMOTE_ADDR" => "10.7.0.6" }
      expect(response).to have_http_status(:too_many_requests)
      expect(account.reload.attributes).to eq(persisted)
    end
  end

  [ "/auth/confirmation", "/auth/password" ].each do |endpoint|
    it "shares #{endpoint} limits across routed JSON format aliases" do
      paths = [ endpoint, "#{endpoint}.json", "#{endpoint}.json/" ]
      5.times do |index|
        post paths[index % paths.size], params: { user: { email: "mailbox@example.com" } }, as: :json
        expect(response).to have_http_status(:accepted)
      end
      post "#{endpoint}.json", params: { user: { email: "mailbox@example.com" } }, as: :json
      expect(response).to have_http_status(:too_many_requests)
    end
  end

  it "shares the persisted-session creation limit between HEAD, GET and routed aliases" do
    travel_to(Time.current.beginning_of_minute + 10.seconds)
    initial_count = ActiveRecord::SessionStore::Session.count
    30.times do |index|
      browser = ActionDispatch::Integration::Session.new(Rails.application)
      path = index % 3 == 0 ? "/auth/session.json" : "/auth/session"
      browser.public_send(index.even? ? :head : :get, path, headers: { "REMOTE_ADDR" => "10.7.4.1" })
      expect(browser.response).to have_http_status(:ok)
    end
    expect(ActiveRecord::SessionStore::Session.count).to eq(initial_count + 30)
    browser = ActionDispatch::Integration::Session.new(Rails.application)
    browser.head "/auth/session.json", headers: { "REMOTE_ADDR" => "10.7.4.1" }
    expect(browser.response).to have_http_status(:too_many_requests)
    expect(ActiveRecord::SessionStore::Session.count).to eq(initial_count + 30)
  end
end
