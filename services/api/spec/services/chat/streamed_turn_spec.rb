# Exercises chat admission and execution through persisted public operations, never providers.
require "rails_helper"

RSpec.describe "Chat streamed turns" do
  let(:user) { create(:user) }
  let(:chat) { user.chat_conversations.create! }
  before { allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :accepted, errors: [])) }

  it "admits an owned message once and commits durable shared-runner delivery" do
    query = 'mutation($id: ID!) { sendChatMessage(input: {conversationId:$id, message:"Help with interviews", idempotencyKey:"first"}) { operation { id status message } errors } }'
    first = execute_graphql(query, user: user, variables: { id: chat.id })
    expect(first["errors"]).to be_nil
    payload = first.dig("data", "sendChatMessage")
    expect(payload["errors"]).to eq([])
    expect(payload.dig("operation", "status")).to eq("pending")
    repeat = execute_graphql(query, user: user, variables: { id: chat.id })
    expect(repeat.dig("data", "sendChatMessage", "operation", "id")).to eq(payload.dig("operation", "id"))
    expect(chat.reload.messages).to be_empty
    operation = ChatOperation.find(payload.dig("operation", "id"))
    expect(operation.delivery_job_id).to be_present
    expect(operation.ai_task.task_type).to eq("chat_reply")
    expect(user.ai_tasks.general_ai.count).to eq(1)
  end
  def start(text = "Career question", key = SecureRandom.uuid)
    Chat::StartMessageService.call(conversation: chat, message: text, idempotency_key: key).value
  end

  def claim(operation)
    Chat::ClaimOperationService.call(operation: operation).value
  end

  def identity(saved)
    saved.slice(:attempt_id, :claim_generation)
  end

  it "rejects excessive text and other owners before admission" do
    result = Chat::StartMessageService.call(conversation: chat, message: "a" * 10_001, idempotency_key: "large")
    expect(result).not_to be_success
    expect(user.ai_tasks).to be_empty
    query = 'mutation($id: ID!) { sendChatMessage(input: {conversationId:$id,message:"Question",idempotencyKey:"other"}) { errors } }'
    expect(execute_graphql(query, user: create(:user), variables: { id: chat.id })["errors"].first["message"]).to eq("Record not found")
    expect(execute_graphql(query, user: nil, variables: { id: chat.id })["errors"].first["message"]).to eq("Authentication required")
  end

  it "serializes messages and refuses conflicting idempotency identities" do
    operation = start("First", "same")
    expect(Chat::StartMessageService.call(conversation: chat, message: "Different", idempotency_key: "same").errors).to include("Submission identity conflicts")
    expect(Chat::StartMessageService.call(conversation: chat, message: "Second", idempotency_key: "other").errors).to include("Wait for the current reply to finish")
    expect(chat.operations.count).to eq(1)
    expect(operation.ai_task).to be_queued
  end

  it "uses canonical owned history, a durable lease and general admission" do
    operation = start
    saved = claim(operation)
    expect(saved.fetch(:payload).slice(:conversation_id, :user_id, :message)).to eq(conversation_id: chat.id, user_id: user.id, message: "Career question")
    expect(operation.reload.recovery_job_id).to be_present
    expect(operation.execution_attempts.count).to eq(1)
    expect(operation.ai_task.ai_usage_attempts.find_by(attempt_id: saved[:attempt_id])).to be_incomplete
    expect(Chat::ClaimOperationService.call(operation: operation)).not_to be_success
    expect(Chat::RenewClaimService.call(operation: operation, **identity(saved))).to be_success
    expect(AiExecutions::Features.operation("chat", operation.id)).to eq(operation)
    expect(AiExecutions::Features.state("chat", operation.id)[:delivered]).to be(true)
  end

  it "accepts one screened pair, replays exactly and excludes provisional messages" do
    operation = start
    saved = claim(operation)
    args = { operation: operation, **identity(saved), reply: "Practise concise examples.", screened_message_sha256: Digest::SHA256.hexdigest(operation.message) }
    expect(Chat::AcceptReplyService.call(**args)).to be_success
    expect(chat.reload.messages.pluck(:role, :content)).to eq([["user", "Career question"], ["assistant", "Practise concise examples."]])
    expect(chat.messages.first.screened_sha256).to eq(args[:screened_message_sha256])
    expect(Chat::AcceptReplyService.call(**args)).to be_success
    expect(Chat::AcceptReplyService.call(**args.merge(reply: "Changed"))).not_to be_success
    expect(chat.messages.count).to eq(2)
    expect(operation.ai_task.reload).to be_completed
    subsequent = start("Next question")
    expect(claim(subsequent).dig(:payload, :messages).map { |m| m.fetch("content") }).to eq(["Career question", "Practise concise examples."])
  end

  it "rejects unapproved historical user messages instead of treating arbitrary saved text as trusted" do
    chat.messages.create!(role: "user", position: 1, content: "Unchecked")
    operation = start
    expect(Chat::ClaimOperationService.call(operation: operation)).not_to be_success
    expect(operation.reload.failure_code).to eq("screening_unavailable")
  end

  it "keeps blocked text out of history and retries the same logical task explicitly" do
    operation = start
    saved = claim(operation)
    expect(Chat::FailOperationService.call(operation: operation, **identity(saved), code: "screening_blocked", retryable: true)).to be_success
    expect(operation.reload).to be_failed
    expect(chat.messages).to be_empty
    expect(Chat::RetryOperationService.call(operation: operation)).to be_success
    next_saved = claim(operation)
    expect(next_saved[:claim_generation]).to eq(saved[:claim_generation] + 1)
    stale = Chat::AcceptReplyService.call(operation: operation, **identity(saved), reply: "Stale", screened_message_sha256: Digest::SHA256.hexdigest(operation.message))
    expect(stale).not_to be_success
    expect(user.ai_tasks.count).to eq(1)
  end

  it "recovers an expired exact lease once while stale watchdogs cannot change current work" do
    operation = start
    saved = claim(operation)
    expected_at = operation.reload.lease_expires_at
    job_id = operation.recovery_job_id
    travel_to(expected_at + 1.second) do
      expect(Chat::RecoverOperationService.call(operation: operation, **{ attempt_id: saved[:attempt_id], generation: saved[:claim_generation], expected_at: expected_at.iso8601(6), job_id: job_id })).to be_success
      expect(operation.reload).to be_pending
      expect(operation.retry_at).to be > Time.current
    end
    travel_to(operation.retry_at + 1.second) do
      next_saved = claim(operation)
      Chat::RecoverOperationService.call(operation: operation, attempt_id: saved[:attempt_id], generation: saved[:claim_generation], expected_at: expected_at.iso8601(6), job_id: job_id)
      expect(operation.reload).to be_running
      expect(operation.attempt_id).to eq(next_saved[:attempt_id])
    end
  end

  it "registers unknown provider calls before dispatch and bills final or stale usage exactly once" do
    operation = start
    saved = claim(operation)
    observation_id = SecureRandom.uuid
    labels = { observation_id: observation_id, stage: "reply", provider: "openai", model: "gpt-6-luna" }
    expect(Chat::StartProviderAttemptService.call(operation: operation, **identity(saved), **labels)).to be_success
    expect(Chat::StartProviderAttemptService.call(operation: operation, **identity(saved), **labels)).to be_success
    report = operation.ai_task.ai_usage_attempts.find_by!(attempt_id: observation_id)
    expect(report).to be_incomplete
    Chat::FailOperationService.call(operation: operation, **identity(saved), code: "execution_failed", retryable: false)
    usage = [{ "input_tokens" => 20, "cached_input_tokens" => 0, "output_tokens" => 8, "cost_microdollars" => 7 }]
    args = { operation: operation, attempt_id: saved[:attempt_id], observation_id: observation_id, usage: usage }
    expect(Chat::RecordUsageService.call(**args)).to be_success
    expect(Chat::RecordUsageService.call(**args)).to be_success
    expect(operation.ai_task.reload.cost_microdollars).to eq(7)
    expect(Chat::RecordUsageService.call(**args.merge(usage: [{ "cost_microdollars" => 99 }]))).not_to be_success
    expect(Chat::RecordUsageService.call(operation: operation, attempt_id: saved[:attempt_id], usage: [], incomplete: false)).to be_success
    expect(operation.ai_task.ai_usage_attempts.where(incomplete: true)).to be_empty
  end

  it "does not borrow interview allowances when the general budget is exhausted" do
    user.update!(monthly_ai_budget_microdollars: 0)
    result = Chat::StartMessageService.call(conversation: chat, message: "Question", idempotency_key: "budget")
    expect(result).not_to be_success
    expect(chat.operations).to be_empty
  end

  it "checks ownership for explicit retry and exposes saved progress with precise ordering" do
    operation = start
    saved = claim(operation)
    Chat::FailOperationService.call(operation: operation, **identity(saved), code: "execution_failed", retryable: false)
    query = 'mutation($id: ID!) { retryChatMessage(input: {operationId:$id}) { operation { id status updatedAt } errors } }'
    expect(execute_graphql(query, user: create(:user), variables: { id: operation.id })["errors"].first["message"]).to eq("Record not found")
    owned = execute_graphql(query, user: user, variables: { id: operation.id }).dig("data", "retryChatMessage")
    expect(owned["errors"]).to eq([])
    expect(owned.dig("operation", "status")).to eq("pending")
    expect(owned.dig("operation", "updatedAt")).to match(/\.\d{6}Z\z/)
  end

  it "ignores obsolete dispatcher fences and surfaces exhausted current dispatch" do
    operation = start
    expect(Chat::StopDeliveryService.call(operation: operation, delivery_job_id: "old")).to be_success
    expect(operation.reload).to be_pending
    expect(Chat::StopDeliveryService.call(operation: operation, delivery_job_id: operation.delivery_job_id)).to be_success
    expect(operation.reload).to be_failed
    expect(operation.failure_code).to eq("dependency_unavailable")
    expect(operation.ai_task.reload).to be_failed
  end

  it "rejects oversized canonical context before creating a provider attempt or unbounded claim response" do
    text = "🙂" * 60001
    chat.messages.create!(role: "user", position: 1, content: text, screened_sha256: Digest::SHA256.hexdigest(text))
    chat.messages.create!(role: "assistant", position: 2, content: text)
    operation = start
    result = Chat::ClaimOperationService.call(operation: operation)
    expect(result).not_to be_success
    expect(operation.reload.failure_code).to eq("context_limit")
    expect(operation.execution_attempts).to be_empty
  end

end
