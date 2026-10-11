# Description: Revision-bound feedback persistence, ownership, failures, and idempotent usage.
# Index:
#   - applying feedback: production result consumer regressions
require "rails_helper"

RSpec.describe "Applying interview answer feedback" do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:question) do
    question_set.questions.create!(position: 1, question_text: "Describe a challenge?",
      answer_text: "I organized a workshop.", answer_revision: 2,
      feedback: { "example_answer" => "Earlier feedback" },
      feedback_question_revision: 1, feedback_answer_revision: 1)
  end
  let(:task) { feedback_task }
  let(:feedback) do
    { "strengths" => [ "Clear action" ], "improvements" => [ "Add the result" ],
      "example_answer" => "I organized a workshop. [add actual outcome]",
      "evidence_quotes" => [ "I organized a workshop." ] }
  end
  let(:message) do
    { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_feedback" => feedback },
      "usage" => [ { "cost_microdollars" => 30 } ] }
  end

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  # Captures the same snapshot as feedback enqueueing.
  def feedback_task
    create(:ai_task, user: user, task_type: "review_interview_answer", subject: question,
      input: { "question_set_id" => question_set.id, "question_id" => question.id,
        "question_text" => question.question_text, "answer_text" => question.answer_text,
        "question_revision" => question.question_revision, "answer_revision" => question.answer_revision })
  end

  # Applies through the real locked and idempotent result path.
  def apply(payload = message)
    AiTasks::ApplyAiResultService.call(message: payload)
  end

  it "stores current coaching without changing the answer, once" do
    2.times { apply }
    expect(question.reload).to have_attributes(answer_text: "I organized a workshop.", answer_revision: 2,
      feedback: feedback, feedback_question_revision: 1, feedback_answer_revision: 2)
    expect(task.reload).to be_completed
    expect(task.cost_microdollars).to eq(30)
    expect(ApiSchema.subscriptions).to have_received(:trigger).once
  end

  it "stores delayed feedback against the old answer revision after an edit" do
    message
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "New answer")
    apply
    expect(question.reload).to have_attributes(answer_text: "New answer", answer_revision: 3,
      feedback: feedback, feedback_answer_revision: 2)
    expect(task.reload).to be_completed
  end

  it "preserves saved answers and earlier coaching on screening/provider failure" do
    original = question.attributes
    apply(message.merge("status" => "failed", "error_message" => "Screen unavailable"))
    expect(question.reload.attributes).to eq(original)
    expect(task.reload).to be_failed
    expect(task.cost_microdollars).to eq(30)
  end

  it "rejects malformed coaching without overwriting old feedback" do
    message
    [ nil, {}, feedback.merge("strengths" => [ " " ]), feedback.merge("example_answer" => 1),
      feedback.merge("improvements" => []), feedback.merge("evidence_quotes" => "not a list") ].each do |draft|
      next_task = feedback_task
      original = question.attributes
      apply(message.merge("ai_task_id" => next_task.id, "result" => { "interview_feedback" => draft }))
      expect(next_task.reload).to be_failed
      expect(question.reload.attributes).to eq(original)
    end
  end

  it "rejects mismatched identity, question revision, answer text, and future revisions" do
    message
    [ { "question_id" => SecureRandom.uuid }, { "question_set_id" => SecureRandom.uuid },
      { "question_revision" => 2 }, { "question_text" => "Changed question" },
      { "answer_revision" => 3 }, { "answer_text" => "Forged answer" } ].each do |change|
      next_task = feedback_task
      next_task.update!(input: next_task.input.merge(change))
      original = question.attributes
      apply(message.merge("ai_task_id" => next_task.id))
      expect(next_task.reload).to be_failed
      expect(question.reload.attributes).to eq(original)
    end
  end

  it "rejects another owner's question" do
    message
    task.update!(user: create(:user))
    original = question.attributes
    apply
    expect(task.reload).to be_failed
    expect(question.reload.attributes).to eq(original)
  end

  it "rejects superseded feedback" do
    message
    feedback_task
    original = question.attributes
    apply
    expect(task.reload).to be_failed
    expect(question.reload.attributes).to eq(original)
  end

  it "retains usage when the question was deleted" do
    message
    question_set.destroy!
    apply
    expect(task.reload).to be_failed
    expect(task.subject).to be_nil
    expect(task.cost_microdollars).to eq(30)
  end
end
