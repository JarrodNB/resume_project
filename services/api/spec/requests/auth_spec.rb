# Account sign-up, sign-in and sign-out use only server-backed browser cookies.
require "rails_helper"

RSpec.describe "Auth", type: :request do
  let(:json_headers) { { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json" } }
  let(:me_query) { { query: "{ me { email } }" }.to_json }

  def sign_in(email:, password:)
    post "/auth/sign_in", params: { user: { email: email, password: password } }.to_json, headers: json_headers
  end

  it "signs up and authenticates with a cookie" do
    post "/auth/sign_up", params: { user: { name: "Ada", email: "ada@example.com", password: "password123" } }.to_json, headers: json_headers
    expect(response).to have_http_status(:created)
    expect(response.headers["Authorization"]).to be_nil
    expect(response.headers["Set-Cookie"]).to include("httponly", "samesite=lax")
    post "/graphql", params: me_query, headers: json_headers
    expect(response.parsed_body.dig("data", "me", "email")).to eq("ada@example.com")
  end

  it "returns validation errors" do
    post "/auth/sign_up", params: { user: { email: "not-an-email", password: "x" } }.to_json, headers: json_headers
    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).not_to be_empty
  end

  it "rejects GraphQL without a session, even with a bearer credential" do
    post "/graphql", params: me_query, headers: json_headers.merge("Authorization" => "Bearer legacy-token")
    expect(response).to have_http_status(:unauthorized)
  end

  it "signs in and signs out idempotently" do
    user = create(:user)
    sign_in(email: user.email, password: "password123")
    expect(response).to have_http_status(:ok)
    post "/graphql", params: me_query, headers: json_headers
    expect(response.parsed_body.dig("data", "me", "email")).to eq(user.email)
    2.times do
      delete "/auth/sign_out", headers: json_headers
      expect(response).to have_http_status(:ok)
    end
    post "/graphql", params: me_query, headers: json_headers
    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects a wrong password" do
    sign_in(email: create(:user).email, password: "wrong-password")
    expect(response).to have_http_status(:unauthorized)
  end

  it "handles malformed credential bodies without errors in throttling or Devise" do
    [ "scalar", [], { user: "scalar" }, { user: { email: [], password: {} } } ].each do |body|
      post "/auth/sign_in", params: body.to_json, headers: json_headers
      expect(response).to have_http_status(:unauthorized)
    end
  end

  it "rejects a malformed signup object without a server error" do
    post "/auth/sign_up", params: { user: "not-an-object" }.to_json, headers: json_headers
    expect(response).to have_http_status(:bad_request)
  end
end
