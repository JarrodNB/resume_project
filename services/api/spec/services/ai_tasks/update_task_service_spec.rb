# Exercises atomic task outcomes, post-commit delivery, rollback and explicit retries.
require "rails_helper"

RSpec.describe AiTasks::UpdateTaskService do
  self.use_transactional_tests = false

  let!(:user) { create(:user) }
  let!(:task) { create(:ai_task, user: user) }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }
  after { user.destroy! }

  it "records one durable outcome and delivers it only after its transaction commits" do
    AiTask.transaction do
      described_class.call(task: task, attributes: { status: "completed", completed_at: Time.current })
      expect(task.ai_task_outcomes.count).to eq(1)
      expect(ApiSchema.subscriptions).not_to have_received(:trigger)
    end
    outcome = task.ai_task_outcomes.sole
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_finished, {},
      { cursor: outcome.sequence.to_s, outcome: outcome }, scope: user.id).once

    described_class.call(task: task, attributes: { status: "completed", completed_at: Time.current })
    expect(task.ai_task_outcomes.count).to eq(1)
    expect(ApiSchema.subscriptions).to have_received(:trigger).once
  end

  it "rolls back the occurrence with its task and never broadcasts a rolled-back outcome" do
    AiTask.transaction do
      described_class.call(task: task, attributes: { status: "failed", completed_at: Time.current })
      raise ActiveRecord::Rollback
    end
    expect(task.reload).to be_queued
    expect(task.ai_task_outcomes).to be_empty
    expect(ApiSchema.subscriptions).not_to have_received(:trigger)
  end

  it "keeps separate outcomes for explicit retries of the same task, even at the same time" do
    travel_to(Time.current) do
      described_class.call(task: task, attributes: { status: "failed", completed_at: Time.current })
      task.update!(status: "queued", completed_at: nil)
      described_class.call(task: task, attributes: { status: "completed", completed_at: Time.current })
    end
    outcomes = task.ai_task_outcomes.order(:sequence)
    expect(outcomes.pluck(:status)).to eq(%w[failed completed])
    expect(outcomes.map(&:id).uniq.length).to eq(2)
    expect(ApiSchema.subscriptions).to have_received(:trigger).twice
  end

  it "keeps committed work when live delivery fails" do
    allow(ApiSchema.subscriptions).to receive(:trigger).and_raise(IOError, "transport unavailable")
    result = described_class.call(task: task, attributes: { status: "completed", completed_at: Time.current })
    expect(result).to be_success
    expect(task.reload).to be_completed
    expect(task.ai_task_outcomes.count).to eq(1)
  end

  it "does not announce a pause or a queued retry" do
    described_class.call(task: task, attributes: { status: "needs_user_input" })
    described_class.call(task: task, attributes: { status: "queued" })
    expect(task.ai_task_outcomes).to be_empty
    expect(ApiSchema.subscriptions).not_to have_received(:trigger)
  end
end
