# Single-question deletion removes derived data without erasing siblings or AI accounting.
require "rails_helper"

RSpec.describe InterviewPrep::DeleteQuestionService do
  it "removes the question's vector and leaves other questions intact" do
    user = create(:user)
    set = user.interview_question_sets.create!(number: 1)
    question = set.questions.create!(position: 1, question_text: "First?", answer_text: "Answer")
    other = set.questions.create!(position: 2, question_text: "Second?")
    vector = question.create_embedding!(content: "First? Answer", content_digest: "digest", model: "test", question_revision: question.question_revision, answer_revision: question.answer_revision, embedding: Array.new(1536, 0.1))
    task = create(:ai_task, user: user, subject: question, task_type: "review_interview_answer")

    expect(described_class.call(question: question)).to be_success
    expect(InterviewQuestion.exists?(question.id)).to be(false)
    expect(InterviewQuestionEmbedding.exists?(vector.id)).to be(false)
    expect(other.reload).to be_persisted
    expect(task.reload.subject).to be_nil
  end
end
