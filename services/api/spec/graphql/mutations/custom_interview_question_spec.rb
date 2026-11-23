# Custom creation returns owned bank records without requiring generation.
require "rails_helper"

RSpec.describe "Custom interview questions" do
  let(:user) { create(:user) }
  it "creates a private question and exposes its immutable origin" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { createCustomInterviewQuestion(input: {setType: KNOWLEDGE, questionText: "What is caching?", answerText: "Reuse saved results."}) {
        errors questionSet { id origin setType questions { id position questionText answerText } }
      } }
    GQL
    payload = result.dig("data", "createCustomInterviewQuestion")
    expect(payload["errors"]).to eq([])
    expect(payload["questionSet"]).to include("origin" => "manual", "setType" => "KNOWLEDGE")
    id = payload["questionSet"]["id"]
    foreign = execute_graphql('query($id: ID!) { interviewQuestionSet(id: $id) { id } }', user: create(:user), variables: { id: id })
    expect(foreign["errors"].first["message"]).to eq("Record not found")
    expect(user.ai_tasks).to be_empty
  end
end
