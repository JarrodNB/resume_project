# Exercises bounded provider admission for long screened messages without calling providers.
require "rails_helper"

RSpec.describe "Chat provider budgets" do
  let(:user) { create(:user) }
  let(:chat) { user.chat_conversations.create! }

  before do
    stub_const("ChatLimits::MAX_INPUT_CHARACTERS", 80_000)
    allow(AiExecutions::NudgeService).to receive(:call)
      .and_return(ServiceResult.new(success: true, value: :accepted, errors: []))
  end

  def reserve(operation, identity, stage)
    Chat::StartProviderAttemptService.call(operation: operation, **identity,
      observation_id: SecureRandom.uuid, stage: stage,
      provider: stage == "screening" ? "typesafe" : "openai",
      model: stage == "screening" ? "jev-1.13.0" : "gpt-6-luna")
  end

  [6000, 2000].each do |chunk_size|
    it "admits full-size screening with #{chunk_size}-character chunks and keeps a separate generation budget" do
      operation = Chat::StartMessageService.call(conversation: chat, message: "a" * 80_000,
        idempotency_key: SecureRandom.uuid).value
      saved = Chat::ClaimOperationService.call(operation: operation).value
      identity = saved.slice(:attempt_id, :claim_generation)
      # The shared screener overlaps 300 characters; reserve primary and fallback for each chunk.
      chunks = (80_000.to_f / (chunk_size - 300)).ceil
      (chunks * 2).times { expect(reserve(operation, identity, "screening")).to be_success }
      4.times { expect(reserve(operation, identity, "reply")).to be_success }
      4.times { expect(reserve(operation, identity, "summary")).to be_success }
      expect(reserve(operation, identity, "reply")).not_to be_success
      expect(operation.execution_attempts.first.provider_attempts.count).to eq(chunks * 2 + 8)
    end
  end

  it "still rejects screening beyond its finite budget before another unknown charge is reserved" do
    operation = Chat::StartMessageService.call(conversation: chat, message: "Career question",
      idempotency_key: SecureRandom.uuid).value
    identity = Chat::ClaimOperationService.call(operation: operation).value.slice(:attempt_id, :claim_generation)
    128.times { expect(reserve(operation, identity, "screening")).to be_success }
    expect { expect(reserve(operation, identity, "screening")).not_to be_success }
      .not_to change { operation.ai_task.ai_usage_attempts.count }
    expect(reserve(operation, identity, "reply")).to be_success
  end
end
