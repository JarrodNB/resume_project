# Verifies ownership and durable skip output through the public GraphQL boundary.
require "rails_helper"
RSpec.describe "Skip interview question GraphQL" do
  let(:user) { create(:user) }
  let(:interview) { Interviews::CreateFixtureService.call(user: user).value }
  let(:mutation) { 'mutation($input: SkipInterviewQuestionInput!) { skipInterviewQuestion(input: $input) { interview { status revision questions { skipped acceptedAnswerCount } } errors } }' }
  let(:variables) { { input: { interviewId: interview.id, questionId: interview.questions.first.id, expectedRevision: 0, submissionKey: "graphql-skip" } } }
  before { allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true) }

  it "hides another owner's interview and returns the owned saved skip" do
    expect(execute_graphql(mutation, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
    result = execute_graphql(mutation, user: user, variables: variables).dig("data", "skipInterviewQuestion")
    expect(result["errors"]).to eq([])
    expect(result["interview"]).to include("status" => "completed", "revision" => 1,
      "questions" => [ { "skipped" => true, "acceptedAnswerCount" => 0 } ])
    expect(execute_graphql(mutation, user: user, variables: variables).dig("data", "skipInterviewQuestion", "errors")).to eq([])
  end
end
