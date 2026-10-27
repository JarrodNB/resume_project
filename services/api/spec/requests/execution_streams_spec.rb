# Session/CSRF grant issuance and separately authenticated observer callbacks.
require "rails_helper"

RSpec.describe "Execution stream authorization", type: :request do
  let(:headers) { { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json", "HTTP_ORIGIN" => "http://localhost:5173" } }
  let(:user) { create(:user) }
  let(:interview) { Interviews::CreateFixtureService.call(user: user).value }
  let(:operation) { interview.operations.speech.first }
  let(:query) { "mutation($input: AuthorizeAiExecutionStreamInput!) { authorizeAiExecutionStream(input: $input) { token expiresAt errors } }" }

  around do |example|
    previous = ActionController::Base.allow_forgery_protection
    ActionController::Base.allow_forgery_protection = true
    example.run
  ensure
    ActionController::Base.allow_forgery_protection = previous
  end

  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("AI_STREAMING_ENABLED").and_return("true")
    allow(ENV).to receive(:[]).with("INTERVIEW_SERVICE_SECRET").and_return("stream-machine-secret")
    Interviews::ClaimOperationService.call(operation: operation)
    get "/auth/session", headers: headers
    csrf = response.parsed_body.fetch("csrfToken")
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }.to_json,
      headers: headers.merge("X-CSRF-Token" => csrf)
    expect(response).to have_http_status(:ok)
    get "/auth/session", headers: headers
    @csrf = response.parsed_body.fetch("csrfToken")
  end

  def issue(id = operation.id, csrf: @csrf)
    post "/graphql", params: { query: query, variables: { input: { feature: "interviews", operationId: id } } }.to_json,
      headers: headers.merge("X-CSRF-Token" => csrf)
  end

  it "requires CSRF and ownership, then issues no session credential in the capability" do
    issue(csrf: "wrong")
    expect(response).to have_http_status(:unprocessable_content)
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value.operations.first
    issue(foreign.id)
    expect(response.parsed_body.dig("data", "authorizeAiExecutionStream", "token")).to be_nil
    issue
    token = response.parsed_body.dig("data", "authorizeAiExecutionStream", "token")
    expect(token).to be_present
    expect(response.headers["Cache-Control"]).to include("no-store")
    post "/internal/execution_streams/redeem", params: { token: token }, as: :json
    expect(response).to have_http_status(:unauthorized)
    post "/internal/execution_streams/redeem", params: { token: token }, as: :json,
      headers: { "Authorization" => "Bearer stream-machine-secret" }
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("operation_id")).to eq(operation.id)
  end

  it "revokes an attached observer after logout without starting another execution" do
    issue
    token = response.parsed_body.dig("data", "authorizeAiExecutionStream", "token")
    post "/internal/execution_streams/redeem", params: { token: token }, as: :json,
      headers: { "Authorization" => "Bearer stream-machine-secret" }
    grant = response.parsed_body.fetch("grant_id")
    delete "/auth/sign_out", headers: headers.merge("X-CSRF-Token" => @csrf)
    post "/internal/execution_streams/check", params: { grant_id: grant }, as: :json,
      headers: { "Authorization" => "Bearer stream-machine-secret" }
    expect(response).to have_http_status(:conflict)
    expect(operation.reload.execution_count).to eq(1)
  end
end
