# Description: Request throttling: sign-in by IP and email, and GraphQL per user.
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

  it "throttles GraphQL per signed-in user" do
    user = create(:user)
    token, = Warden::JWTAuth::UserEncoder.new.call(user, :user, nil)
    auth_headers = json_headers.merge("Authorization" => "Bearer #{token}")

    120.times { |request_number| post "/graphql", params: { query: "{ me { email } }" }.to_json, headers: auth_headers.merge("REMOTE_ADDR" => "10.1.0.#{request_number % 200}") }
    expect(response).to have_http_status(:ok)

    post "/graphql", params: { query: "{ me { email } }" }.to_json, headers: auth_headers

    expect(response).to have_http_status(:too_many_requests)
  end
end
