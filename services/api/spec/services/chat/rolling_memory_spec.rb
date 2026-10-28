# Exercises memory through durable claims and atomic reply acceptance, retaining visible dialogue.
require "rails_helper"
require "digest"

RSpec.describe "Chat rolling memory" do
  let(:user) { create(:user, ai_tasks_per_hour_limit: 200) }
  let(:chat) { user.chat_conversations.create! }
  before { allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :accepted, errors: [])) }

  def append_exchanges(from, through, text_size: nil)
    (from..through).each do |turn|
      text = text_size ? "u" * text_size : "User fact #{turn}"
      chat.messages.create!(role: "user", position: turn * 2 - 1, content: text, screened_sha256: Digest::SHA256.hexdigest(text))
      chat.messages.create!(role: "assistant", position: turn * 2, content: "Reply #{turn}")
    end
  end

  def start_and_claim
    operation = Chat::StartMessageService.call(conversation: chat, message: "Next career step", idempotency_key: SecureRandom.uuid).value
    [operation, Chat::ClaimOperationService.call(operation: operation)]
  end

  def accept(operation, saved, **extra)
    Chat::AcceptReplyService.call(operation: operation, **saved.slice(:attempt_id, :claim_generation), reply: "Focus on your next application.",
      screened_message_sha256: Digest::SHA256.hexdigest(operation.message), **extra)
  end

  it "plans the first 20-turn rolling checkpoint without deleting visible history" do
    append_exchanges(1, 19)
    operation, result = start_and_claim
    expect(result).to be_success
    saved = result.value
    expect(saved.dig(:payload, :summary)).to eq(text: "", version: 0, through_position: 0)
    expect(saved.dig(:payload, :summary_plan)).to eq(through_position: 30, scheduled: true)
    expect(saved.dig(:payload, :messages).map { |m| m.fetch("position") }).to eq((1..38).to_a)
    expect(accept(operation, saved, summary_update: { "text" => "Facts 1–15", "expected_version" => 0, "through_position" => 30 })).to be_success
    expect(chat.reload.attributes.slice("summary_text", "summary_version", "summary_through_position")).to eq(
      "summary_text" => "Facts 1–15", "summary_version" => 1, "summary_through_position" => 30)
    expect(chat.messages.count).to eq(40)
  end

  it "rolls the previous summary into the second checkpoint and retains every interim exchange" do
    append_exchanges(1, 19)
    operation, result = start_and_claim
    update = { "text" => "Facts 1–15", "expected_version" => 0, "through_position" => 30 }
    expect(accept(operation, result.value, summary_update: update)).to be_success
    # The turn after a checkpoint still receives all uncovered dialogue, not just five new messages.
    next_operation, next_result = start_and_claim
    expect(next_result.value.dig(:payload, :summary)).to eq(text: "Facts 1–15", version: 1, through_position: 30)
    expect(next_result.value.dig(:payload, :summary_plan)).to be_nil
    expect(next_result.value.dig(:payload, :messages).map { |m| m.fetch("position") }).to eq((31..40).to_a)
    expect(accept(next_operation, next_result.value)).to be_success
    append_exchanges(22, 39)
    second_operation, second = start_and_claim
    expect(second.value.dig(:payload, :summary_plan)).to eq(through_position: 70, scheduled: true)
    expect(second.value.dig(:payload, :messages).map { |m| m.fetch("position") }).to eq((31..78).to_a)
    second_update = { "text" => "Facts 1–35, including previous summary", "expected_version" => 1, "through_position" => 70 }
    expect(accept(second_operation, second.value, summary_update: second_update)).to be_success
    expect(accept(second_operation, second.value, summary_update: second_update.reverse_each.to_h)).to be_success
    expect(chat.reload.summary_version).to eq(2)
    expect(chat.summary_through_position).to eq(70)
    expect(chat.messages.count).to eq(80)
  end

  it "plans early compaction before a large history reaches the prompt cap" do
    append_exchanges(1, 12, text_size: 10_000)
    operation, result = start_and_claim
    expect(result).to be_success
    expect(result.value.dig(:payload, :summary_plan)).to eq(through_position: 14, scheduled: false)
    expect(accept(operation, result.value, summary_update: { "text" => "Earlier facts", "expected_version" => 0, "through_position" => 14 })).to be_success
    expect(chat.reload.messages.count).to eq(26)
    _, next_result = start_and_claim
    expect(next_result.value.dig(:payload, :summary_plan)).to be_nil # Cadence did not reset to a new 20-turn cycle.
    expect(next_result.value.dig(:payload, :messages).first.fetch("position")).to eq(15)
  end

  it "selects only uncovered messages even when full visible history is much larger than model context" do
    append_exchanges(1, 100, text_size: 2000)
    chat.update!(summary_text: "Facts through turn95", summary_version: 5, summary_through_position: 190)
    _, result = start_and_claim
    expect(result).to be_success
    expect(result.value.dig(:payload, :messages).map { |m| m.fetch("position") }).to eq((191..200).to_a)
    expect(chat.messages.count).to eq(200)
  end

  it "rejects a minimum recent window that cannot fit without dropping one of its five exchanges" do
    append_exchanges(1, 5, text_size: 24_000)
    operation, result = start_and_claim
    expect(result).not_to be_success
    expect(operation.reload.failure_code).to eq("context_limit")
    expect(operation.execution_attempts).to be_empty
    expect(chat.reload.summary_version).to eq(0)
    expect(chat.messages.count).to eq(10)
  end

  it "requires the exact planned bounded summary and preserves state on failure" do
    append_exchanges(1, 19)
    operation, result = start_and_claim
    saved = result.value
    expect(accept(operation, saved)).not_to be_success
    expect(accept(operation, saved, summary_update: { "text" => "Wrong coverage", "expected_version" => 0, "through_position" => 32 })).not_to be_success
    expect(accept(operation, saved, summary_update: { "text" => "x" * 8001, "expected_version" => 0, "through_position" => 30 })).not_to be_success
    expect(chat.reload.summary_version).to eq(0)
    expect(chat.messages.count).to eq(38)
    expect(Chat::FailOperationService.call(operation: operation, **saved.slice(:attempt_id, :claim_generation), code: "execution_failed", retryable: false)).to be_success
    expect(Chat::RetryOperationService.call(operation: operation)).to be_success
    retry_result = Chat::ClaimOperationService.call(operation: operation)
    expect(retry_result.value.dig(:payload, :summary_plan)).to eq(through_position: 30, scheduled: true)
    expect(chat.reload.summary_version).to eq(0)
    expect(chat.messages.count).to eq(38)
  end

  it "fences summary application to the claimed version and attempt" do
    append_exchanges(1, 19)
    operation, result = start_and_claim
    update = { "text" => "Facts 1–15", "expected_version" => 0, "through_position" => 30 }
    changed_version = update.merge("expected_version" => 1)
    expect(accept(operation, result.value, summary_update: changed_version)).not_to be_success
    stale = result.value.merge(attempt_id: SecureRandom.uuid)
    expect(accept(operation, stale, summary_update: update)).not_to be_success
    chat.update!(summary_text: "A newer source", summary_version: 1, summary_through_position: 2)
    expect(accept(operation, result.value, summary_update: update)).not_to be_success
    expect(chat.reload.summary_text).to eq("A newer source")
    expect(chat.messages.count).to eq(38)
  end


  it "compacts long sequences of small messages before their snapshot row bound is exhausted" do
    stub_const("ChatLimits::SUMMARIZE_EVERY_USER_MESSAGES", 10_000)
    append_exchanges(1, 450)
    _, result = start_and_claim
    expect(result).to be_success
    expect(result.value.dig(:payload, :summary_plan)).to eq(through_position: 890, scheduled: false)
  end


  it "rejects transport-expanded source snapshots before reserving a provider execution" do
    (1..19).each do |turn|
      text = "<" * 10_000
      chat.messages.create!(role: "user", position: turn * 2 - 1, content: text, screened_sha256: Digest::SHA256.hexdigest(text))
      chat.messages.create!(role: "assistant", position: turn * 2, content: "Reply")
    end
    operation, result = start_and_claim
    expect(result).not_to be_success
    expect(operation.reload.failure_code).to eq("context_limit")
    expect(operation.execution_attempts).to be_empty
  end

end
