# Checks the public explicit-request contract and owner-scoped feedback visibility.
require "rails_helper"

RSpec.describe "Completed interview feedback GraphQL" do
  let(:user) { create(:user) }
  let(:interview) { Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value }
  let(:mutation) { 'mutation($id: ID!) { requestInterviewSessionFeedback(input: {interviewId: $id}) { feedback { id status content aiTaskId deadline } errors } }' }
  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
    interview.messages.create!(question: interview.questions.first, kind: "answer", position: 1, semantic_key: "answer", content: "I built a scheduler.")
    interview.update!(status: "completed", completed_at: Time.current)
  end

  it "requests feedback and restores its safe saved status" do
    result = execute_graphql(mutation, user: user, variables: { id: interview.id })
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "requestInterviewSessionFeedback", "errors")).to eq([])
    expect(result.dig("data", "requestInterviewSessionFeedback", "feedback", "status")).to eq("queued")
    saved = execute_graphql("query($id: ID!) { interviewSession(id: $id) { feedback { id status content } } }", user: user, variables: { id: interview.id })
    expect(saved.dig("data", "interviewSession", "feedback", "id")).to eq(interview.reload.feedback.id)
  end

  it "does not reveal or queue another user's interview" do
    result = execute_graphql(mutation, user: create(:user), variables: { id: interview.id })
    expect(result["errors"]).to be_present
    expect(interview.reload.feedback).to be_nil
  end
end
