# The GraphQL endpoint answers badly formed variables with a 400 instead of a server error.
require "rails_helper"

RSpec.describe "GraphQL variables", type: :request do
  let(:user) { create(:user) }
  let(:json_headers) { { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json" } }

  before do
    get "/auth/session", headers: json_headers
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }.to_json, headers: json_headers
    expect(response).to have_http_status(:ok)
  end

  def run(variables)
    post "/graphql", params: { query: "{ __typename }", variables: variables }.to_json, headers: json_headers
  end

  it "rejects variables that are not valid JSON" do
    run("{not json")
    expect(response).to have_http_status(:bad_request)
  end

  it "rejects variables that are JSON but not an object" do
    run("[1, 2]")
    expect(response).to have_http_status(:bad_request)
  end

  it "accepts an object, a blank string, and a missing value" do
    [ '{"a": 1}', "", nil ].each do |variables|
      run(variables)
    expect(response).to have_http_status(:ok)
    end
  end
end
