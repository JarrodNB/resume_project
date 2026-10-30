# Description: Repairing AI tasks that were saved but never sent to the ai_tasks queue.
require "rails_helper"

RSpec.describe AiTasks::RepublishUnpublishedTasksService do
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before { allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue) }

  def unpublished_task(age:, **attributes)
    create(:ai_task, awaiting_queue_publish: true, created_at: age.ago, **attributes)
  end

  it "publishes a task that has waited past the grace period and clears its marker" do
    task = unpublished_task(age: 2.minutes)

    described_class.call

    expect(queue).to have_received(:send_message).once do |message_body:|
      expect(JSON.parse(message_body)).to eq("schema_version" => 1, "ai_task_id" => task.id,
        "user_id" => task.user_id, "task_type" => task.task_type)
    end
    expect(task.reload.awaiting_queue_publish).to be(false)
    expect(task).to be_queued
  end

  it "leaves brand-new tasks to their own request" do
    task = unpublished_task(age: 5.seconds)

    described_class.call

    expect(queue).not_to have_received(:send_message)
    expect(task.reload.awaiting_queue_publish).to be(true)
  end

  it "never touches tasks that do not use the queue" do
    create(:ai_task, created_at: 5.minutes.ago)

    described_class.call

    expect(queue).not_to have_received(:send_message)
  end

  it "fails tasks that have been stuck longer than the in-flight window" do
    task = unpublished_task(age: 20.minutes)

    described_class.call

    expect(queue).not_to have_received(:send_message)
    expect(task.reload).to be_failed
    expect(task.awaiting_queue_publish).to be(false)
    expect(task.ai_task_outcomes.sole.status).to eq("failed")
  end

  it "keeps the marker when the queue is still unreachable" do
    task = unpublished_task(age: 2.minutes)
    allow(queue).to receive(:send_message)
      .and_raise(Seahorse::Client::NetworkingError.new(StandardError.new("connection refused")))

    expect(described_class.call).to be_success
    expect(task.reload.awaiting_queue_publish).to be(true)
    expect(task).to be_queued
  end
end
