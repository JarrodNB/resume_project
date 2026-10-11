# Description: Interview practice queries return only owned sets and revision-aware feedback.
# Index:
#   - interview queries: ordering, ownership, feedback freshness, and reloadable tasks
require "rails_helper"

RSpec.describe "Interview practice queries" do
  let(:user) { create(:user) }

  it "lists only owned sets newest first" do
    first = user.interview_question_sets.create!(number: 1)
    second = user.interview_question_sets.create!(number: 2, created_at: 1.minute.from_now)
    create(:user).interview_question_sets.create!(number: 1)
    result = execute_graphql("{ interviewQuestionSets { id number questions { id } } }", user: user)
    expect(result.dig("data", "interviewQuestionSets").map { |item| item["id"] }).to eq([ second.id, first.id ])
  end

  it "exposes ordered answers, outdated feedback, and latest task on reload" do
    question_set = user.interview_question_sets.create!(number: 1)
    question = question_set.questions.create!(position: 1, question_text: "Why?", answer_revision: 2,
      feedback: { "strengths" => [ "Clear" ] }, feedback_question_revision: 1, feedback_answer_revision: 1)
    task = user.ai_tasks.create!(task_type: "review_interview_answer", subject: question)
    result = execute_graphql(<<~GQL, user: user, variables: { id: question_set.id })
      query($id: ID!) { interviewQuestionSet(id: $id) {
        id questions { id questionText feedbackOutdated latestTask { id } }
      } }
    GQL
    expect(result.dig("data", "interviewQuestionSet", "questions")).to eq([
      { "id" => question.id, "questionText" => "Why?", "feedbackOutdated" => true, "latestTask" => { "id" => task.id } }
    ])
  end

  it "rejects another user's set" do
    other_set = create(:user).interview_question_sets.create!(number: 1)
    result = execute_graphql(<<~GQL, user: user, variables: { id: other_set.id })
      query($id: ID!) { interviewQuestionSet(id: $id) { id } }
    GQL
    expect(result["errors"].first["message"]).to eq("Record not found")
  end
end
