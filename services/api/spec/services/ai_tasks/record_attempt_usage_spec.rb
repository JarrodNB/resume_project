# Description: Attempt charges survive retries, late delivery and duplicate result messages.
# Index:
#   - examples: observable task totals and unchanged task outcomes
require "rails_helper"

RSpec.describe AiTasks::ApplyAiResultService do
  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  it "marks an unpriced receipt incomplete even if the producer omits its flag" do
    task = create(:ai_task)
    described_class.call(message: { "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid,
      "usage" => [ { "model" => "unpriced-model", "input_tokens" => 100, "cost_microdollars" => nil } ] })
    expect(task.ai_usage_attempts.sole).to be_incomplete
    expect(task.reload.cost_microdollars).to eq(0)
  end

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

  it "counts late tailoring executions without changing the completed draft" do
    draft = { "sections" => [ { "section_type" => "summary", "content" => { "text" => "Finished draft" } } ] }
    task = create(:ai_task, task_type: "tailor_resume", status: "completed", result: draft,
                  input: { "job_id" => SecureRandom.uuid })
    snapshots = task.input.deep_dup
    message = { "ai_task_id" => task.id, "status" => "failed",
                "attempt_id" => SecureRandom.uuid, "usage" => [ { "cost_microdollars" => 7 } ] }
    2.times { described_class.call(message: message) }
    described_class.call(message: message.merge("attempt_id" => SecureRandom.uuid))
    expect(task.reload.cost_microdollars).to eq(14)
    expect(task).to be_completed
    expect(task.result).to eq(draft)
    expect(task.input).to eq(snapshots)
    expect(ApiSchema.subscriptions).not_to have_received(:trigger).with(:ai_task_updated, anything, anything)
  end
end
