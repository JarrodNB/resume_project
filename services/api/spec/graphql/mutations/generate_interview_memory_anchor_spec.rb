# Anchor generation authorizes both IDs and queues only saved-source references.
require "rails_helper"

RSpec.describe "Generate interview memory anchor" do
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { set.questions.create!(position: 1, question_text: "What improved?") }
  let(:mutation) do
    <<~GRAPHQL
      mutation($set: ID!, $question: ID!) {
        generateInterviewMemoryAnchor(input: {questionSetId: $set, questionId: $question, answerText: "I simplified reporting.", memoryAnchor: "My cue"}) {
          errors aiTask { taskType input }
        }
      }
    GRAPHQL
  end
  before { allow(Shoryuken::Client).to receive(:queues).and_return(instance_double(Shoryuken::Queue, send_message: nil)) }

  it "saves the draft before enqueueing a reference-only command" do
    result = execute_graphql(mutation, user: user, variables: { set: set.id, question: question.id })
    payload = result.dig("data", "generateInterviewMemoryAnchor")
    expect(payload["errors"]).to eq([])
    expect(payload["aiTask"]["taskType"]).to eq("GENERATE_INTERVIEW_MEMORY_ANCHOR")
    expect(payload["aiTask"]["input"].to_json).not_to include("I simplified reporting.", "My cue")
    expect(question.reload).to have_attributes(answer_text: "I simplified reporting.", memory_anchor: "My cue")
  end

  it "rejects a different user's set and question" do
    result = execute_graphql(mutation, user: create(:user), variables: { set: set.id, question: question.id })
    expect(result["errors"]).to be_present
    expect(question.reload.ai_tasks).to be_empty
  end

  it "rejects a question from a different owned set" do
    other = user.interview_question_sets.create!(number: 2)
    result = execute_graphql(mutation, user: user, variables: { set: other.id, question: question.id })
    expect(result["errors"]).to be_present
    expect(question.reload.ai_tasks).to be_empty
  end
end
