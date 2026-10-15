# Description: Real separate database connections exercise duplicate delivery and competing replacements.
# Index:
#   - concurrent results examples: owner/task locks and once-only usage accounting
require "rails_helper"

RSpec.describe "Concurrent interview results" do
  self.use_transactional_tests = false

  let(:user) { create(:user) }
  let(:question_set) { user.interview_question_sets.create!(number: 1) }
  let(:drafts) do
    %w[introduction strengths development goals behavioral].map.with_index do |category, index|
      { "question_text" => "Question about career #{index}?", "category" => category,
        "evidence_quotes" => [ "Career" ] }
    end
  end

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }
  after { user.destroy! }

  # Releases worker threads together and propagates their exceptions back to the example.
  def apply_concurrently(messages)
    ready = Queue.new
    start = Queue.new
    threads = messages.map do |message|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          ready << true
          start.pop
          AiTasks::ApplyAiResultService.call(message: message)
        end
      end
    end
    messages.length.times { ready.pop }
    messages.length.times { start << true }
    threads.map(&:value)
  end

  # Builds a publishable result with nonzero usage.
  def message_for(task, questions)
    { "ai_task_id" => task.id, "status" => "completed",
      "result" => { "interview_questions" => { "questions" => questions } },
      "usage" => [ { "cost_microdollars" => 30 } ] }
  end

  it "applies duplicate deliveries only once across separate connections" do
    task = create(:ai_task, user: user, task_type: "generate_interview_questions", subject: question_set,
                  input: { "question_set_id" => question_set.id })
    message = message_for(task, drafts).merge("attempt_id" => SecureRandom.uuid)
    expect(apply_concurrently([ message, message ])).to all(be_success)
    expect(question_set.questions.count).to eq(5)
    expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 30)
    expect(task.ai_usage_attempts.count).to eq(1)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: task.id }, task).once
  end

  it "adds distinct concurrent retry charges without changing task status" do
    task = create(:ai_task, user: user)
    messages = Array.new(2) do
      { "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid,
        "usage" => [ { "cost_microdollars" => 30 } ] }
    end
    expect(apply_concurrently(messages)).to all(be_success)
    expect(task.reload).to have_attributes(status: "queued", cost_microdollars: 60)
    expect(task.ai_usage_attempts.count).to eq(2)
  end

  it "resolves concurrent start and final reports without resurrecting uncertainty" do
    task = create(:ai_task, user: user)
    started = { "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid,
                "attempt_finished" => false, "usage_incomplete" => true }
    finished = started.merge("attempt_finished" => true, "usage_incomplete" => false,
                             "usage" => [ { "cost_microdollars" => 30 } ])
    expect(apply_concurrently([ started, finished ])).to all(be_success)
    expect(task.reload.cost_microdollars).to eq(30)
    expect(task.ai_usage_attempts.count).to eq(1)
    expect(task.ai_usage_attempts.first).to have_attributes(finalized: true, incomplete: false)
  end

  it "serializes replacements on different slots to prevent a duplicate question" do
    questions = drafts.map.with_index do |draft, index|
      question_set.questions.create!(position: index + 1, question_text: draft["question_text"])
    end
    tasks = questions.take(2).map do |question|
      create(:ai_task, user: user, task_type: "regenerate_interview_question", subject: question,
        input: { "question_set_id" => question_set.id, "question_id" => question.id,
                 "question_text" => question.question_text, "question_revision" => 1, "answer_revision" => 0 })
    end
    replacement = drafts.first.merge("question_text" => "What would you like to develop next?")
    apply_concurrently(tasks.map { |task| message_for(task, [ replacement ]) })
    expect(tasks.map { |task| task.reload.status }.sort).to eq(%w[completed failed])
    expect(question_set.questions.where(question_text: replacement["question_text"]).count).to eq(1)
    expect(tasks.map(&:cost_microdollars)).to eq([ 30, 30 ])
  end
end
