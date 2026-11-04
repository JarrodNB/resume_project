# Entry replacement keeps the owning task's known totals consistent, including failures.
require "rails_helper"

RSpec.describe AiUsage::AttemptEntries do
  let(:task) { create(:ai_task) }
  let(:attempt) { task.ai_usage_attempts.create!(attempt_id: SecureRandom.uuid) }

  def replace(entries)
    task.with_lock { described_class.replace(attempt, entries, ai_task: task) }
  end

  it "replaces one receipt without losing other receipts or double counting repeated writes" do
    replace([ { "cost_microdollars" => 35, "input_tokens" => 20, "model" => "first" } ])
    other = task.ai_usage_attempts.create!(attempt_id: SecureRandom.uuid)
    task.with_lock { described_class.replace(other, [ { "cost_microdollars" => 10 } ], ai_task: task) }
    2.times { replace([ { "cost_microdollars" => 55, "output_tokens" => 7 } ]) }
    expect(task.reload).to have_attributes(cost_microdollars: 65, input_tokens: 0, output_tokens: 7)
    expect(described_class.as_hashes(attempt)).to eq([ { "cost_microdollars" => 55, "output_tokens" => 7 } ])
    replace([])
    expect(task.reload).to have_attributes(cost_microdollars: 10, output_tokens: 0)
  end

  it "rolls back row replacement when updating the task fails" do
    replace([ { "cost_microdollars" => 35 } ])
    allow(task).to receive(:update!).and_raise(ActiveRecord::RecordInvalid.new(task))
    expect { replace([ { "cost_microdollars" => 55 } ]) }.to raise_error(ActiveRecord::RecordInvalid)
    expect(task.reload.cost_microdollars).to eq(35)
    expect(described_class.as_hashes(attempt)).to eq([ { "cost_microdollars" => 35 } ])
  end

  it "rejects a receipt for another task before changing either record" do
    other = create(:ai_task)
    expect { other.with_lock { described_class.replace(attempt, [], ai_task: other) } }.to raise_error(ArgumentError)
    expect(task.reload.cost_microdollars).to eq(0)
    expect(other.reload.cost_microdollars).to eq(0)
  end
end
