# Description: Creating an AiTask and publishing it to the ai_tasks queue.
require "rails_helper"

RSpec.describe AiTasks::EnqueueAiTaskService do
  let(:user) { create(:user) }
  let(:queue) { instance_double(Shoryuken::Queue, send_message: nil) }

  before { allow(Shoryuken::Client).to receive(:queues).with(AI_TASKS_QUEUE_NAME).and_return(queue) }

  it "creates a queued task and publishes its message" do
    result = described_class.call(user: user, task_type: "analyze_gaps", input: { "job_id" => "abc", "legacy_source" => "PRIVATE SAVED SOURCE", "history" => [ "PRIVATE HISTORY" ] })

    expect(result).to be_success
    ai_task = result.value
    expect(ai_task).to be_persisted.and be_queued
    expect(ai_task.reload.awaiting_queue_publish).to be(false)
    expect(queue).to have_received(:send_message) do |message_body:|
      expect(JSON.parse(message_body)).to eq(
        "ai_task_id" => ai_task.id,
        "user_id" => user.id,
        "task_type" => "analyze_gaps",
        "schema_version" => 1
      )
    end
  end

  it "fails without publishing for an unknown task type" do
    result = described_class.call(user: user, task_type: "write_cover_letter")

    expect(result).not_to be_success
    expect(queue).not_to have_received(:send_message)
  end

  it "creates nothing and publishes nothing when the user has reached an AI usage limit" do
    user.update!(max_in_flight_ai_tasks: 1)
    create(:ai_task, user: user)

    result = described_class.call(user: user, task_type: "analyze_gaps")

    expect(result.errors).to eq([ "You already have AI tasks running. Wait for them to finish, then try again." ])
    expect(user.ai_tasks.count).to eq(1)
    expect(queue).not_to have_received(:send_message)
  end

  it "marks the task failed when the queue is unreachable" do
    allow(queue).to receive(:send_message)
      .and_raise(Seahorse::Client::NetworkingError.new(StandardError.new("connection refused")))

    result = described_class.call(user: user, task_type: "analyze_gaps")

    expect(result).not_to be_success
    ai_task = user.ai_tasks.last
    expect(ai_task).to be_failed
    expect(ai_task.completed_at).to be_present
    expect(ai_task.ai_task_outcomes.sole.status).to eq("failed")
  end

  it "returns resolved work before limits without saving or publishing another task" do
    existing = create(:ai_task, user: user)
    user.update!(max_in_flight_ai_tasks: 1)
    resolver = -> { ServiceResult.new(success: true, value: existing, errors: []) }

    result = described_class.call(user: user, task_type: "analyze_gaps", resolve_existing: resolver)

    expect(result.value).to eq(existing)
    expect(user.ai_tasks.count).to eq(1)
    expect(queue).not_to have_received(:send_message)
  end

  it "returns a resolution failure without creating or publishing work" do
    resolver = -> { ServiceResult.new(success: false, value: nil, errors: [ "Already saved" ]) }

    result = described_class.call(user: user, task_type: "analyze_gaps", resolve_existing: resolver)

    expect(result.errors).to eq([ "Already saved" ])
    expect(user.ai_tasks).to be_empty
    expect(queue).not_to have_received(:send_message)
  end
end
