# Verified receipt imports correct durable accounting once without altering task outcomes.
require "rails_helper"

RSpec.describe AiUsage::ReconcileReceiptService do
  let(:user) { create(:user) }
  let(:task) { create(:ai_task, user: user, status: "completed", cost_microdollars: 35) }
  let(:report) { task.ai_usage_attempts.create!(attempt_id: SecureRandom.uuid, finalized: true, incomplete: true,
    usage: [ { "cost_microdollars" => 35 } ]) }
  let(:params) { { user: user, record_type: "task", attempt_id: report.attempt_id, receipt_reference: "provider-receipt-line-1",
    usage: [ { "cost_microdollars" => 55, "input_tokens" => 100 } ] } }

  it "dry-runs then applies one exact delta, preserves evidence and ignores duplicate delivery" do
    expect(described_class.call(**params).value).to include(previous_cost_microdollars: 35, cost_microdollars: 55)
    expect(task.reload.cost_microdollars).to eq(35)
    expect(AiUsageReconciliation.count).to eq(0)
    2.times { expect(described_class.call(**params, apply: true)).to be_success }
    expect(task.reload).to have_attributes(cost_microdollars: 55, input_tokens: 100, status: "completed")
    expect(report.reload).to have_attributes(incomplete: false, finalized: true)
    expect(AiUsageReconciliation.sole.previous_usage).to eq([ { "cost_microdollars" => 35 } ])
    AiTasks::RecordAttemptUsageService.call(ai_task: task, message: { "attempt_id" => report.attempt_id,
      "usage" => [ { "cost_microdollars" => 35 } ] })
    expect(task.reload.cost_microdollars).to eq(55)
  end

  it "rejects another user's receipt, conflicting reimports, and invalid charges" do
    other = create(:user)
    expect(described_class.call(**params.merge(user: other), apply: true)).not_to be_success
    expect(described_class.call(**params.merge(usage: [ { "cost_microdollars" => -1 } ]), apply: true)).not_to be_success
    expect(described_class.call(**params, apply: true)).to be_success
    expect(described_class.call(**params.merge(usage: [ { "cost_microdollars" => 70 } ]), apply: true)).not_to be_success
    expect(task.reload.cost_microdollars).to eq(55)
  end

  it "resolves a crashed embedding request and exposes its known cost in the combined summary" do
    request = user.ai_embedding_requests.create!(model: "text-embedding-3-small", purpose: "career_library")
    input = { user: user, record_type: "embedding", attempt_id: request.id, receipt_reference: "embedding-receipt-line-1",
      usage: [ { "input_tokens" => 1_000, "cost_microdollars" => 20 } ], apply: true }
    2.times { expect(described_class.call(**input)).to be_success }
    expect(request.reload).to have_attributes(input_tokens: 1_000, cost_microdollars: 20, incomplete: false, finalized: true)
    expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: user).value).to have_attributes(spent_microdollars: 20, incomplete_attempts: 0)
  end

  it "reconciles retained spoken verification reservations along with the user's total" do
    reservation = InterviewVerificationReservation.create!(observation_id: report.attempt_id, reserved_microdollars: 100)
    expect(described_class.call(**params, apply: true)).to be_success
    expect(reservation.reload.actual_microdollars).to eq(55)
  end
end
