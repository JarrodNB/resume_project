# Older queued Luna receipts lack cache-write evidence; keep their totals and expose uncertainty.
require "rails_helper"
require Rails.root.join("db/migrate/20261027020100_flag_unverifiable_luna_usage")

RSpec.describe FlagUnverifiableLunaUsage do
  it "flags only unverifiable queued Luna receipts without changing their known charges" do
    task = create(:ai_task, cost_microdollars: 100)
    entries = [
      { "model" => "openai:gpt-6-luna", "cost_microdollars" => 25 },
      { "model" => "openai:gpt-6-luna", "cache_write_tokens" => 0, "cost_microdollars" => 25 },
      { "model" => "gpt-6-luna", "cost_microdollars" => 25 },
      { "model" => "openai:gpt-5-nano", "cost_microdollars" => 25 }
    ]
    reports = entries.map do |entry|
      task.ai_usage_attempts.create!(attempt_id: SecureRandom.uuid, usage: [ entry ], finalized: true)
    end
    migration = described_class.new
    migration.suppress_messages { 2.times { migration.up } }
    expect(reports.map { |report| report.reload.incomplete? }).to eq([ true, false, false, false ])
    expect(task.reload.cost_microdollars).to eq(100)
    expect(reports.map(&:usage)).to eq(entries.map { |entry| [ entry ] })
  end
end
