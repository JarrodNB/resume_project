# Exercise durable question avoidance through the public owned-question mutation.
require "rails_helper"

RSpec.describe "Avoided interview questions" do
  let(:user) { create(:user, summary: "Team leader") }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge.", answer_text: "My saved answer") }
  let(:operation) do
    <<~GQL
      mutation($set: ID!, $question: ID!, $revision: Int!) {
        avoidInterviewQuestion(input: {questionSetId: $set, questionId: $question, expectedRevision: $revision}) {
          saved errors
        }
      }
    GQL
  end

  def avoid(owner = user, revision: question.question_revision)
    execute_graphql(operation, user: owner, variables: { set: question_set.id, question: question.id, revision: revision })
  end

  it "saves once without modifying the question or answer, and survives source deletion" do
    2.times { expect(avoid.dig("data", "avoidInterviewQuestion")).to eq("saved" => true, "errors" => []) }
    expect(user.avoided_interview_questions.pluck(:question_text)).to eq([ "Describe a challenge." ])
    expect(question.reload.answer_text).to eq("My saved answer")
    detail = execute_graphql("query($id: ID!) { interviewQuestionSet(id: $id) { questions { avoided } } }", user: user, variables: { id: question_set.id })
    expect(detail.dig("data", "interviewQuestionSet", "questions", 0, "avoided")).to be(true)
    question_set.destroy!
    expect(user.avoided_interview_questions.count).to eq(1)
  end
  it "snapshots only this user's saved questions into new generation and replacement tasks" do
    expect(avoid.dig("data", "avoidInterviewQuestion", "saved")).to be(true)
    create(:user).avoided_interview_questions.create!(question_text: "Someone else's question", text_digest: "other")
    allow(Shoryuken::Client).to receive(:queues).and_return(instance_double(Shoryuken::Queue, send_message: nil))
    generation = execute_graphql("mutation { generateInterviewQuestionSet(input: {}) { aiTask { input } errors } }", user: user)
    input = generation.dig("data", "generateInterviewQuestionSet", "aiTask", "input")
    expect(input["avoided_questions"]).to eq([ question.question_text ])
    question_set.destroy!
    expect(user.ai_tasks.find_by!(task_type: "generate_interview_questions").input["avoided_questions"]).to eq([ "Describe a challenge." ])
    next_set = user.interview_question_sets.order(:number).last
    next_question = next_set.questions.create!(position: 1, question_text: "What did you learn?")
    replacement = execute_graphql(<<~GQL, user: user, variables: { set: next_set.id, question: next_question.id })
      mutation($set: ID!, $question: ID!) { regenerateInterviewQuestion(input: {questionSetId: $set, questionId: $question}) { aiTask { input } errors } }
    GQL
    expect(replacement.dig("data", "regenerateInterviewQuestion", "aiTask", "input", "avoided_questions")).to eq([ "Describe a challenge." ])
  end

  it "rejects another user's question without revealing it or saving a preference" do
    other_user = create(:user)
    expect(avoid(other_user).dig("errors", 0, "message")).to eq("Record not found")
    expect(other_user.avoided_interview_questions).to be_empty
  end

  it "rejects a stale revision instead of saving the replacement's text" do
    revision = question.question_revision
    question.update!(question_text: "A new question?", question_revision: revision + 1)
    result = avoid(revision: revision).dig("data", "avoidInterviewQuestion")
    expect(result["saved"]).to be(false)
    expect(result["errors"]).to include(/question changed/)
    expect(user.avoided_interview_questions).to be_empty
  end
end
