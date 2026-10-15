# Description: Attempt charges survive retries, late delivery and duplicate result messages.
# Index:
#   - examples: observable task totals and unchanged task outcomes
require "rails_helper"

RSpec.describe AiTasks::ApplyAiResultService do
  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  it "retains an unfinished execution as unknown and resolves it without double counting" do
    task = create(:ai_task)
    started = { "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid,
                "attempt_finished" => false, "usage_incomplete" => true, "usage" => [] }
    described_class.call(message: started)
    expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: task.user).value.incomplete_attempts).to eq(1)
    finished = started.merge("status" => "completed", "attempt_finished" => true, "usage_incomplete" => false,
                             "usage" => [ { "model" => "openai:gpt-5-mini", "cost_microdollars" => 35 } ])
    2.times { described_class.call(message: finished) }
    described_class.call(message: started)
    expect(task.reload).to be_completed
    expect(task.cost_microdollars).to eq(35)
    expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: task.user).value.incomplete_attempts).to eq(0)
  end

  it "adds retry costs exactly once and accepts late usage after completion" do
    task = create(:ai_task)
    retry_usage = {
      "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid,
      "usage_incomplete" => true,
      "usage" => [ { "model" => "openai:gpt-5-mini", "input_tokens" => 100,
                    "cached_input_tokens" => 20, "output_tokens" => 5, "cost_microdollars" => 35 } ]
    }
    result = described_class.call(message: retry_usage)
    expect(result).to be_success
    expect(task.reload).to be_queued
    expect(task.cost_microdollars).to eq(35)

    completed = retry_usage.merge("status" => "completed", "attempt_id" => SecureRandom.uuid,
                                 "usage_incomplete" => false, "result" => { "ok" => true })
    2.times { expect(described_class.call(message: completed)).to be_success }
    2.times { expect(described_class.call(message: retry_usage)).to be_success }
    late = retry_usage.merge("attempt_id" => SecureRandom.uuid)
    2.times { expect(described_class.call(message: late)).to be_success }

    expect(task.reload).to be_completed
    expect(task.result).to eq("ok" => true)
    expect(task.cost_microdollars).to eq(105)
    expect(task.input_tokens).to eq(300)
    expect(task.cached_input_tokens).to eq(60)
    expect(ApiSchema.subscriptions).to have_received(:trigger)
      .with(:ai_task_updated, { id: task.id }, task).once
  end

  it "counts separate executions of an old tailoring generation without changing its draft" do
    task = create(:ai_task, task_type: "tailor_resume", generation: 2, status: "needs_user_input",
                  input: { "approved_sections" => [ { "section_type" => "contact" } ] })
    message = { "ai_task_id" => task.id, "status" => "failed", "generation" => 1,
                "attempt_id" => SecureRandom.uuid, "usage" => [ { "cost_microdollars" => 7 } ] }
    2.times { described_class.call(message: message) }
    described_class.call(message: message.merge("attempt_id" => SecureRandom.uuid))
    expect(task.reload.cost_microdollars).to eq(14)
    expect(task).to be_needs_user_input
    expect(task.generation).to eq(2)
    expect(task.input).to eq("approved_sections" => [ { "section_type" => "contact" } ])
    expect(ApiSchema.subscriptions).not_to have_received(:trigger).with(:ai_task_updated, anything, anything)
  end
end
