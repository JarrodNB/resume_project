# Generated recall cues preserve the answer, custom edits, ownership and task accounting.
require "rails_helper"

RSpec.describe "Generating interview memory anchors" do
  let(:user) { create(:user) }
  let(:set) { user.interview_question_sets.create!(number: 1) }
  let(:question) { set.questions.create!(position: 1, question_text: "What improved?", answer_text: "I simplified reporting. It became faster.", answer_revision: 1, memory_anchor: "My cue") }
  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(instance_double(Shoryuken::Queue, send_message: nil))
    allow(ApiSchema.subscriptions).to receive(:trigger)
  end

  def start
    InterviewPrep::StartQuestionTaskService.call(user: user, question: question, task_type: "generate_interview_memory_anchor", answer_text: question.answer_text, memory_anchor: question.memory_anchor)
  end

  def apply(task, anchor = "Simplified reporting → faster")
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "memory_anchor" => anchor }, "usage" => [{ "cost_microdollars" => 30 }] })
  end

  it "queues only references and applies once without changing the answer or feedback" do
    task = start.value
    expect(task).to be_queued
    expect(task.input.to_json).not_to include(question.answer_text, question.memory_anchor)
    expect(start).not_to be_success
    2.times { apply(task) }
    expect(task.reload).to be_completed
    expect(task.cost_microdollars).to eq(30)
    expect(question.reload).to have_attributes(memory_anchor: "Simplified reporting → faster", answer_revision: 1, answer_text: "I simplified reporting. It became faster.")
  end

  %i[answer question anchor deleted foreign superseded].each do |change|
    it "preserves newer work when #{change} changes" do
      task = start.value
      case change
      when :answer then question.update!(answer_revision: 2, answer_text: "New answer")
      when :question then question.update!(question_revision: 2)
      when :anchor then question.update!(memory_anchor: "New custom cue")
      when :deleted then question.destroy!
      when :foreign then task.update!(user: create(:user))
      when :superseded then question.ai_tasks.create!(user: user, task_type: task.task_type, status: "failed", input: task.input)
      end
      before = question.reload.attributes unless change == :deleted
      apply(task)
      expect(task.reload).to be_failed
      expect(question.reload.attributes).to eq(before) unless change == :deleted
    end
  end

  [nil, "", "a" * 601, 123].each do |invalid|
    it "rejects invalid output #{invalid.inspect[0, 20]}" do
      task = start.value
      apply(task, invalid)
      expect(task.reload).to be_failed
      expect(question.reload.memory_anchor).to eq("My cue")
    end
  end

  it "saves drafts even when admission fails and supports later retry" do
    user.update!(max_in_flight_ai_tasks: 0)
    result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question, task_type: "generate_interview_memory_anchor", answer_text: "Changed answer", memory_anchor: "Custom")
    expect(result).not_to be_success
    expect(question.reload).to have_attributes(answer_text: "Changed answer", memory_anchor: "Custom")
    user.update!(max_in_flight_ai_tasks: 5)
    expect(start).to be_success
  end

  it "rejects a cue changed between saving and admission" do
    allow(AiTasks::EnqueueAiTaskService).to receive(:call).and_wrap_original do |original, **arguments|
      question.update!(memory_anchor: "Newer custom cue")
      original.call(**arguments)
    end
    result = InterviewPrep::StartQuestionTaskService.call(user: user, question: question,
      task_type: "generate_interview_memory_anchor", answer_text: "My answer", memory_anchor: "Earlier cue")
    expect(result).not_to be_success
    expect(question.reload.memory_anchor).to eq("Newer custom cue")
    expect(question.ai_tasks).to be_empty
  end

  it "requires an answer" do
    question.update!(answer_text: " ")
    expect(start).not_to be_success
    expect(question.ai_tasks).to be_empty
  end
end
