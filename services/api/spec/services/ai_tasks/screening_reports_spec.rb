# Successful source checks survive task failure and redelivery without changing accounting.
require "rails_helper"

RSpec.describe "Screening success result reports" do
  let(:task) { create(:ai_task) }
  let(:approval) { { "content_digest" => "a" * 64, "policy_identity" => "b" * 64 } }
  let(:attempt_id) { SecureRandom.uuid }

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  def apply(status, reports = [ approval ], **fields)
    AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => task.id, "status" => status, "attempt_id" => attempt_id,
      "screening_successes" => reports, "usage" => [ { "cost_microdollars" => 7 } ]
    }.merge(fields.stringify_keys))
  end

  %w[completed failed usage].each do |status|
    it "stores #{status} checks once for the task owner and counts usage once" do
      2.times { expect(apply(status)).to be_success }
      expect(ScreeningDecision.count).to eq(1)
      expect(ScreeningDecision.sole).to have_attributes(user_id: task.user_id, **approval.symbolize_keys)
      expect(task.reload.cost_microdollars).to eq(7)
      expect(task.status).to eq(status == "usage" ? "queued" : status)
    end
  end

  it "accepts late checks without replacing a finished outcome or repeating usage" do
    apply("failed", [], error_message: "Original failure")
    apply("completed", [ approval ], result: { "late" => true })
    expect(ScreeningDecision.count).to eq(1)
    expect(task.reload).to have_attributes(status: "failed", error_message: "Original failure", cost_microdollars: 7)
    expect(ApiSchema.subscriptions).to have_received(:trigger).once
  end

  it "discards the whole invalid report batch while still applying outcome and usage" do
    invalid = approval.merge("user_id" => create(:user).id)
    2.times { expect(apply("completed", [ approval, invalid ], result: {})).to be_success }
    expect(ScreeningDecision.count).to eq(0)
    expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 7)
  end

  [ nil, {}, "raw text", [ { "content_digest" => "a", "policy_identity" => "b" * 64 } ],
    Array.new(1001) { { "content_digest" => "a" * 64, "policy_identity" => "b" * 64 } } ].each do |invalid|
    it "ignores malformed or unbounded report metadata #{invalid.class}" do
      expect(apply("failed", invalid)).to be_success
      expect(ScreeningDecision.count).to eq(0)
      expect(task.reload.cost_microdollars).to eq(7)
    end
  end

  it "keeps identical approvals isolated by task owner and deletes them with accounts" do
    apply("failed")
    other = create(:ai_task)
    AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => other.id, "status" => "failed", "screening_successes" => [ approval ]
    })
    expect(ScreeningDecision.count).to eq(2)
    task.user.destroy!
    expect(ScreeningDecision.pluck(:user_id)).to eq([ other.user_id ])
  end
end
