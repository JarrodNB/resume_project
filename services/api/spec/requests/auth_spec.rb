# Description: End-to-end JWT auth: sign up, sign in, authenticated GraphQL, sign out revokes.
require "rails_helper"

RSpec.describe "Auth", type: :request do
  let(:json_headers) { { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json" } }
  let(:me_query) { { query: "{ me { email } }" }.to_json }

  def sign_in(email:, password:)
    post "/auth/sign_in", params: { user: { email: email, password: password } }.to_json, headers: json_headers
  end

  it "signs up and returns a JWT" do
    post "/auth/sign_up",
         params: { user: { name: "Ada", email: "ada@example.com", password: "password123" } }.to_json,
         headers: json_headers

    expect(response).to have_http_status(:created)
    expect(response.headers["Authorization"]).to start_with("Bearer ")
  end

  it "returns validation errors for a bad sign-up" do
    post "/auth/sign_up", params: { user: { email: "not-an-email", password: "x" } }.to_json, headers: json_headers

    expect(response).to have_http_status(:unprocessable_content)
    expect(response.parsed_body["errors"]).not_to be_empty
  end

  it "rejects GraphQL requests without a token" do
    post "/graphql", params: me_query, headers: json_headers
    expect(response).to have_http_status(:unauthorized)
  end

  it "signs in, uses the token for GraphQL, and revokes it on sign-out" do
    user = create(:user)
    sign_in(email: user.email, password: "password123")
    expect(response).to have_http_status(:ok)
    auth_headers = json_headers.merge("Authorization" => response.headers["Authorization"])

    post "/graphql", params: me_query, headers: auth_headers
    expect(response.parsed_body.dig("data", "me", "email")).to eq(user.email)

    delete "/auth/sign_out", headers: auth_headers
    expect(response).to have_http_status(:ok)

    post "/graphql", params: me_query, headers: auth_headers
    expect(response).to have_http_status(:unauthorized)
  end

  it "rejects a wrong password" do
    user = create(:user)
    sign_in(email: user.email, password: "wrong-password")
    expect(response).to have_http_status(:unauthorized)
  end
end
