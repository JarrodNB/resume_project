# Checks single-question deletion through the public API, including ownership and retained usage.
require "rails_helper"

RSpec.describe "Delete interview question" do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { question_set.questions.create!(position: 1, question_text: "Describe a challenge.", answer_text: "My answer") }
  let(:mutation) do
    <<~GQL
      mutation($set: ID!, $question: ID!) {
        deleteInterviewQuestion(input: {questionSetId: $set, questionId: $question}) { errors }
      }
    GQL
  end

  it "deletes only the selected question and retains its task accounting" do
    other = question_set.questions.create!(position: 2, question_text: "Another question")
    task = create(:ai_task, user: user, subject: question, task_type: "review_interview_answer")
    result = execute_graphql(mutation, user: user, variables: { set: question_set.id, question: question.id })
    expect(result.dig("data", "deleteInterviewQuestion", "errors")).to eq([])
    expect(InterviewQuestion.exists?(question.id)).to be(false)
    expect(other.reload.question_text).to eq("Another question")
    expect(question_set.reload).to be_persisted
    expect(task.reload.subject).to be_nil
  end

  it "rejects another user's set" do
    result = execute_graphql(mutation, user: create(:user), variables: { set: question_set.id, question: question.id })
    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(question.reload).to be_persisted
  end

  it "rejects a question from a different set" do
    other_set = user.interview_question_sets.create!(number: 2)
    result = execute_graphql(mutation, user: user, variables: { set: other_set.id, question: question.id })
    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(question.reload).to be_persisted
  end
end
