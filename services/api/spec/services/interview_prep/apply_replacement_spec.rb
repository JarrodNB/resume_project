# Description: Replacement results preserve content until success and reject obsolete snapshots.
# Index:
#   - AiTasks::ApplyAiResultService interview replacement examples
require "rails_helper"

RSpec.describe "Applying an interview question replacement" do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:questions) do
    5.times.map do |index|
      question_set.questions.create!(position: index + 1, question_text: "Old question number #{index}?",
        answer_text: "Answer #{index}", answer_revision: 2, feedback: { "example_answer" => "Example" },
        feedback_question_revision: 1, feedback_answer_revision: 2)
    end
  end
  let(:question) { questions.first }
  let(:task) { replacement_task(question) }
  let(:message) do
    { "ai_task_id" => task.id, "status" => "completed",
      "result" => { "interview_questions" => { "questions" => [
        { "question_text" => "What would you like to develop next?", "category" => "development",
          "evidence_quotes" => [ "Career details" ] }
      ] } }, "usage" => [ { "cost_microdollars" => 30 } ] }
  end

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  context "with a technical set" do
    let(:question_set) { user.interview_question_sets.create!(number: 1, set_type: "technical") }

    it "keeps the set type and clears only the selected answer after success" do
      originals = questions.drop(1).map(&:attributes)
      task.update!(input: task.input.merge("set_type" => "technical"))
      message["result"]["interview_questions"]["questions"][0]["category"] = "problem_solving"
      2.times { apply }
      expect(task.reload).to be_completed
      expect(question_set.reload.set_type).to eq("technical")
      expect(question.reload.answer_text).to eq("")
      expect(questions.drop(1).map { |record| record.reload.attributes }).to eq(originals)
    end

    it "rejects a mismatched type snapshot and preserves content" do
      original = question.attributes
      apply
      expect(task.reload).to be_failed
      expect(question.reload.attributes).to eq(original)
    end
  end

  # Captures the same identity and revisions as the queue preparation service.
  def replacement_task(target)
    create(:ai_task, user: user, task_type: "regenerate_interview_question", subject: target,
      input: { "question_set_id" => question_set.id, "question_id" => target.id,
               "question_text" => target.question_text, "question_revision" => target.question_revision,
               "answer_revision" => target.answer_revision })
  end

  # Uses the production result consumer transaction.
  def apply(payload = message)
    AiTasks::ApplyAiResultService.call(message: payload)
  end

  it "replaces only the selected question, clears its answer/feedback, and advances revisions once" do
    other_attributes = questions.drop(1).map(&:attributes)
    2.times { apply }
    expect(task.reload).to be_completed
    expect(question.reload).to have_attributes(question_text: "What would you like to develop next?",
      question_revision: 2, answer_revision: 3, answer_text: "", feedback: {},
      feedback_question_revision: nil, feedback_answer_revision: nil)
    expect(questions.drop(1).map { |record| record.reload.attributes }).to eq(other_attributes)
    expect(task.cost_microdollars).to eq(30)
  end

  it "preserves question, answer, and feedback on worker failure" do
    original = question.attributes
    apply(message.merge("status" => "failed", "error_message" => "Unavailable"))
    apply
    expect(question.reload.attributes).to eq(original)
    expect(task.reload).to be_failed
  end

  it "rejects changes to either revision, question text, or snapshot identity" do
    message
    [ { "question_revision" => 2 }, { "answer_revision" => 3 },
      { "question_text" => "A changed question?" }, { "question_set_id" => SecureRandom.uuid },
      { "question_id" => SecureRandom.uuid } ].each do |changes|
      new_task = replacement_task(question)
      new_task.update!(input: new_task.input.merge(changes))
      original = question.attributes
      apply(message.merge("ai_task_id" => new_task.id))
      expect(new_task.reload).to be_failed
      expect(question.reload.attributes).to eq(original)
    end
  end

  it "rejects a superseded task even when the revisions still match" do
    task
    replacement_task(question)
    apply
    expect(task.reload).to be_failed
    expect(question.reload.question_revision).to eq(1)
  end

  it "checks duplicates against both the old question and the current other four" do
    message
    [ question.question_text, questions.last.question_text.upcase.gsub("?", "!") ].each do |text|
      new_task = replacement_task(question)
      payload = message.deep_dup
      payload["ai_task_id"] = new_task.id
      payload["result"]["interview_questions"]["questions"][0]["question_text"] = text
      apply(payload)
      expect(new_task.reload).to be_failed
      expect(question.reload.answer_text).to eq("Answer 0")
    end
  end

  it "prevents two different replacements from introducing the same question" do
    first_message = message
    second_task = replacement_task(questions.last)
    apply(first_message)
    apply(first_message.merge("ai_task_id" => second_task.id))
    expect(task.reload).to be_completed
    expect(second_task.reload).to be_failed
    expect(questions.last.reload.answer_text).to eq("Answer 4")
  end

  it "keeps the answer and feedback when the replacement draft is malformed" do
    original = question.attributes
    message["result"] = nil
    apply
    expect(task.reload).to be_failed
    expect(question.reload.attributes).to eq(original)
  end
end
