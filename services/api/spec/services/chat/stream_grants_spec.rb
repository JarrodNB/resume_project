# Chat opts into the same session-bound observer grants used by the shared stream transport.
require "rails_helper"
RSpec.describe "Chat stream authority" do
  let(:user) { create(:user) }
  let(:chat) { user.chat_conversations.create! }
  let(:session_id) { Rack::Session::SessionId.new(SecureRandom.hex(32)) }
  let(:operation) { Chat::StartMessageService.call(conversation: chat, message: "Career help", idempotency_key: "stream").value }
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("AI_STREAMING_ENABLED").and_return("true")
    allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: :accepted, errors: []))
    ActiveRecord::SessionStore::Session.create!(session_id: session_id.private_id,
      data: { "warden.user.user.key" => User.serialize_into_session(user), "authenticated_at" => Time.current.to_i })
    Chat::ClaimOperationService.call(operation: operation)
  end
  def authorize(owner = user)
    AiExecutions::AuthorizeStreamService.call(user: owner, session_id: session_id, feature: "chat", operation_id: operation.id)
  end
  it "attaches a read-only observer to the current owned attempt without new work" do
    grant = authorize
    expect(grant).to be_success
    receipt = AiExecutions::StreamGrantService.call(action: "redeem", token: grant.value.fetch(:token))
    expect(receipt).to be_success
    expect(receipt.value).to include(feature: "chat", operation_id: operation.id, attempt_id: operation.reload.attempt_id)
    expect(operation.execution_count).to eq(1)
    expect(authorize(create(:user))).not_to be_success
  end
  it "revokes delivery when an attempt is superseded" do
    token = authorize.value.fetch(:token)
    Chat::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id, claim_generation: operation.claim_generation, code: "execution_failed", retryable: false)
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: token)).not_to be_success
    Chat::RetryOperationService.call(operation: operation)
    Chat::ClaimOperationService.call(operation: operation)
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: token)).not_to be_success
    expect(authorize).to be_success
  end
end
