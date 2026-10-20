# Description: Set generation result validation, atomicity, identity, and usage idempotency.
# Index:
#   - AiTasks::ApplyAiResultService interview generation examples
require "rails_helper"

RSpec.describe "Applying interview question generation" do
  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:task) do
    create(:ai_task, user: user, task_type: "generate_interview_questions", subject: question_set,
           input: { "question_set_id" => question_set.id })
  end
  let(:drafts) do
    %w[introduction collaboration problem_solving learning_adaptation initiative_judgment].map.with_index do |category, index|
      { "question_text" => "Question about your career number #{index}?", "category" => category,
        "evidence_quotes" => [ "Career details" ] }
    end
  end
  let(:message) do
    { "ai_task_id" => task.id, "status" => "completed",
      "result" => { "interview_questions" => { "questions" => drafts } },
      "usage" => [ { "input_tokens" => 20, "output_tokens" => 10, "cost_microdollars" => 30 } ] }
  end

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  %w[technical knowledge].each do |set_type|
    context "with a #{set_type} set" do
      let(:question_set) { user.interview_question_sets.create!(number: 1, set_type: set_type) }
      before { task.update!(input: task.input.merge("set_type" => set_type)) }

      it "persists five scope-specific categories and ignores duplicate deliveries" do
        drafts.zip(InterviewPrep::ApplyQuestionsService::CATEGORIES_BY_TYPE.fetch(set_type)).each { |draft, category| draft["category"] = category }
        2.times { apply }
        expect(task.reload).to be_completed
        expect(question_set.questions.count).to eq(5)
        expect(question_set.reload.set_type).to eq(set_type)
        expect(task.cost_microdollars).to eq(30)
      end

      it "rejects general categories without creating questions" do
        apply
        expect(task.reload).to be_failed
        expect(question_set.questions).to be_empty
      end

      it "rejects a missing legacy type snapshot on a non-general set" do
        task.update!(input: task.input.except("set_type"))
        apply
        expect(task.reload).to be_failed
        expect(question_set.questions).to be_empty
      end
    end
  end

  # Applies a message through the production consumer service.
  def apply(payload = message)
    AiTasks::ApplyAiResultService.call(message: payload)
  end

  it "persists exactly five ordered questions and usage once for a duplicate result" do
    2.times { expect(apply).to be_success }
    expect(question_set.questions.pluck(:position)).to eq([ 1, 2, 3, 4, 5 ])
    expect(question_set.questions.pluck(:question_text)).to eq(drafts.pluck("question_text"))
    expect(task.reload).to have_attributes(status: "completed", input_tokens: 20,
                                          output_tokens: 10, cost_microdollars: 30)
    expect(ApiSchema.subscriptions).to have_received(:trigger).once
  end

  it "accepts a complete legacy category set from an in-flight older worker" do
    drafts.zip(%w[introduction strengths development goals behavioral]).each { |draft, category| draft["category"] = category }
    apply
    expect(task.reload).to be_completed
    expect(question_set.questions.count).to eq(5)
  end

  it "rejects a mixture of legacy and current categories atomically" do
    drafts[1]["category"] = "strengths"
    apply
    expect(task.reload).to be_failed
    expect(question_set.questions).to be_empty
  end

  [ nil, {}, { "interview_questions" => [] },
    { "interview_questions" => { "questions" => "invalid" } } ].each do |payload|
    it "fails malformed result #{payload.inspect} without persisting slots" do
      message["result"] = payload
      apply
      expect(task.reload).to be_failed
      expect(task.result).to be_nil
      expect(question_set.questions).to be_empty
    end
  end

  it "rejects wrong counts, duplicates, blank text, and malformed evidence" do
    invalid = [ drafts.take(4), drafts + [ drafts.first ],
                drafts.map { |draft| draft.merge("question_text" => " ") },
                drafts.map { |draft| draft.merge("question_text" => "Same question?") },
                drafts.map { |draft| draft.merge("evidence_quotes" => [ nil ]) } ]
    invalid.each do |questions|
      ai_task = create(:ai_task, user: user, task_type: task.task_type, subject: question_set,
                       input: task.input)
      apply(message.merge("ai_task_id" => ai_task.id,
                          "result" => { "interview_questions" => { "questions" => questions } }))
      expect(ai_task.reload).to be_failed
      expect(question_set.questions).to be_empty
    end
  end

  it "rolls back the first slots if a later question fails model validation" do
    allow_any_instance_of(InterviewQuestion).to receive(:save!).and_wrap_original do |original, **options|
      record = original.receiver
      record.question_text = "" if record.position == 3
      original.call(**options)
    end
    apply
    expect(task.reload).to be_failed
    expect(question_set.questions).to be_empty
  end

  it "does not overwrite a populated set" do
    question_set.questions.create!(position: 1, question_text: "Existing question?")
    apply
    expect(task.reload).to be_failed
    expect(question_set.questions.pluck(:question_text)).to eq([ "Existing question?" ])
  end

  it "rejects a mismatched snapshot ID or another owner's subject" do
    task.update!(input: { "question_set_id" => SecureRandom.uuid })
    apply
    expect(question_set.questions).to be_empty
    other_task = create(:ai_task, task_type: task.task_type, subject: question_set,
                        input: { "question_set_id" => question_set.id })
    apply(message.merge("ai_task_id" => other_task.id))
    expect(other_task.reload).to be_failed
    expect(question_set.questions).to be_empty
  end

  it "rejects a superseded task but retains its billed usage once" do
    task
    create(:ai_task, user: user, task_type: task.task_type, subject: question_set, input: task.input)
    2.times { apply }
    expect(task.reload).to have_attributes(status: "failed", cost_microdollars: 30)
    expect(question_set.questions).to be_empty
  end

  it "accounts for late results after deletion without recreating the set" do
    payload = message
    InterviewPrep::DeleteQuestionSetService.call(question_set: question_set)
    2.times { apply(payload) }
    expect(task.reload).to have_attributes(status: "failed", subject_id: nil, cost_microdollars: 30)
    expect(user.interview_question_sets).to be_empty
  end

  it "preserves an empty set on worker failure and ignores a late successful result" do
    apply(message.merge("status" => "failed", "error_message" => "Screen unavailable"))
    apply
    expect(task.reload.error_message).to eq("Screen unavailable")
    expect(question_set.questions).to be_empty
  end
end
