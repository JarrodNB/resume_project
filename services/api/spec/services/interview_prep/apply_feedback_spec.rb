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

  %w[technical knowledge].each do |set_type|
    context "with a #{set_type} set" do
      let(:question_set) { user.interview_question_sets.create!(number: 1, set_type: set_type) }

      it "stores coaching once while preserving the typed answer" do
        task.update!(input: task.input.merge("set_type" => set_type))
        2.times { apply }
        expect(task.reload).to be_completed
        expect(question.reload).to have_attributes(answer_text: "I organized a workshop.", feedback: feedback)
      end

      it "rejects mismatched type snapshots without replacing prior coaching" do
        original = question.attributes
        apply
        expect(task.reload).to be_failed
        expect(question.reload.attributes).to eq(original)
      end
    end
  end

  context "with knowledge corrections" do
    let(:question_set) { user.interview_question_sets.create!(number: 1, set_type: "knowledge") }
    let(:question) do
      question_set.questions.create!(position: 1, question_text: "How do lists and tuples differ?",
        answer_text: "Lists are immutable, but tuples can be appended to.", answer_revision: 1)
    end
    let(:feedback) do
      { "strengths" => [ "You compare the types." ], "improvements" => [ "Reverse your mutability claim." ],
        "example_answer" => "Lists are mutable; tuples are immutable sequences.", "evidence_quotes" => [] }
    end

    it "stores corrected subject explanations separately from the incorrect typed answer" do
      original_answer = question.answer_text
      task.update!(input: task.input.merge("set_type" => "knowledge"))
      2.times { apply }
      expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 30)
      expect(question.reload).to have_attributes(answer_text: original_answer, answer_revision: 1,
        feedback: feedback, feedback_answer_revision: 1, feedback_question_revision: 1)
      expect(user.career_contexts).to be_empty
      expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: task.id }, task).once
    end
  end

  context "with reference-only feedback commands" do
    let(:task) do
      legacy = feedback_task
      legacy.update!(input: legacy.input.except("question_text", "answer_text").merge(
        "source_version" => 1, "normalized_answer_sha256" => InterviewPrep::FeedbackOutdatedService.answer_fingerprint(question.answer_text)))
      legacy
    end

    it "stores feedback once against the requested revisions without source copies" do
      2.times { apply }
      expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 30)
      expect(question.reload).to have_attributes(answer_text: "I organized a workshop.", feedback: feedback,
        feedback_answer_revision: 2, feedback_question_revision: 1)
      expect(task.input.keys).not_to include("answer_text", "question_text", "screened_fields")
    end

    it "keeps a later answer and attributes delayed feedback to the original revision" do
      message
      InterviewPrep::SaveAnswerService.call(question: question, answer_text: "New answer")
      apply
      expect(task.reload).to be_completed
      expect(question.reload).to have_attributes(answer_text: "New answer", answer_revision: 3,
        feedback: feedback, feedback_answer_revision: 2)
      expect(InterviewPrep::FeedbackOutdatedService.call(question: question).value).to be(true)
    end

    it "recognizes formatting-only edits using a digest rather than a reviewed answer copy" do
      apply
      InterviewPrep::SaveAnswerService.call(question: question, answer_text: " I ORGANIZED  a workshop. ")
      expect(InterviewPrep::FeedbackOutdatedService.call(question: question.reload).value).to be(false)
    end

    it "rejects malformed or mismatched references while preserving earlier feedback" do
      message
      [ { "question_id" => SecureRandom.uuid }, { "question_set_id" => SecureRandom.uuid },
       { "answer_revision" => 3 }, { "source_version" => 2 } ].each do |change|
        target = feedback_task
        target.update!(input: task.input.merge(change))
        original = question.reload.attributes
        apply(message.merge("ai_task_id" => target.id))
        expect(target.reload).to be_failed
        expect(question.reload.attributes).to eq(original)
      end
    end

    it "rejects changed questions" do
      message
      question.update!(question_revision: 2)
      apply
      expect(task.reload).to be_failed
      expect(question.reload.feedback).not_to eq(feedback)
    end
  end

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
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: task.id }, task).once
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
