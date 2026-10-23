# Verify browser ownership and the separate machine credential for streaming capture callbacks.
require "rails_helper"

RSpec.describe "Interview transcription permissions", type: :request do
  let(:user) { create(:user) }
  let(:interview) { Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value }
  let(:query) { "mutation($input: AuthorizeInterviewTranscriptionInput!) { authorizeInterviewTranscription(input: $input) { captureId token errors } }" }
  let(:input) { { interviewId: interview.id, questionId: interview.questions.first.id, expectedRevision: 0 } }

  before { allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true) }

  around do |example|
    previous = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "capture-test-secret"
    example.run
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = previous
  end

  it "requires owner identity for issuing a capability" do
    result = execute_graphql(query, user: nil, variables: { input: input })
    expect(result["errors"].first["message"]).to eq("Authentication required")
    foreign = execute_graphql(query, user: create(:user), variables: { input: input })
    expect(foreign["errors"].first["message"]).to eq("Record not found")
    expect(InterviewTranscriptionCapture.count).to eq(0)
    owned = execute_graphql(query, user: user, variables: { input: input }).dig("data", "authorizeInterviewTranscription")
    expect(owned["errors"]).to eq([])
    expect(owned["token"]).to be_present
  end

  it "requires the machine secret independently of the browser capability" do
    grant = Interviews::AuthorizeTranscriptionService.call(interview: interview, question_id: interview.questions.first.id, expected_revision: 0).value
    path = "/internal/interviews/transcriptions/redeem"
    post path, params: { token: grant[:token] }, as: :json
    expect(response).to have_http_status(:unauthorized)
    post path, params: { token: grant[:token] }, headers: { "Authorization" => "Bearer capture-test-secret" }, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body["capture_id"]).to eq(grant[:capture_id])
    post "/internal/interviews/transcriptions/fail", params: { capture_id: grant[:capture_id], usage: [] },
      headers: { "Authorization" => "Bearer capture-test-secret" }, as: :json
    expect(response).to have_http_status(:conflict)
    expect(response.parsed_body["errors"]).to eq([ "Invalid usage" ])
  end
end
