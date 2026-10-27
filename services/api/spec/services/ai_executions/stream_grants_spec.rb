# Stream grants authorize observers without claiming or restarting paid execution.
require "rails_helper"

RSpec.describe "AI execution stream grants" do
  let(:user) { create(:user) }
  let(:session_id) { Rack::Session::SessionId.new(SecureRandom.hex(32)) }
  let!(:browser_session) do
    ActiveRecord::SessionStore::Session.create!(session_id: session_id.private_id,
      data: { "warden.user.user.key" => User.serialize_into_session(user), "authenticated_at" => Time.current.to_i })
  end
  let(:interview) { Interviews::CreateFixtureService.call(user: user).value }
  let(:operation) { interview.operations.speech.first }

  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("AI_STREAMING_ENABLED").and_return("true")
    expect(Interviews::ClaimOperationService.call(operation: operation).success?).to be(true)
  end

  def authorize(owner: user, browser: session_id)
    AiExecutions::AuthorizeStreamService.call(user: owner, session_id: browser,
      feature: "interviews", operation_id: operation.id)
  end

  it "issues a short-lived observer capability scoped to the saved current attempt" do
    before = operation.reload.execution_count
    grant = authorize
    expect(grant.success?).to be(true)
    expect(grant.value.fetch(:token).length).to be_between(40, 100)
    receipt = AiExecutions::StreamGrantService.call(action: "redeem", token: grant.value.fetch(:token))
    expect(receipt.success?).to be(true)
    expect(receipt.value).to include(feature: "interviews", operation_id: operation.id,
      attempt_id: operation.attempt_id, claim_generation: operation.claim_generation)
    expect(operation.reload.execution_count).to eq(before)
    expect(AiExecutionStreamGrant.first.token_digest).not_to eq(grant.value[:token])
  end

  it "does not authorize another owner or an unrelated browser session" do
    expect(authorize(owner: create(:user)).success?).to be(false)
    expect(authorize(browser: Rack::Session::SessionId.new(SecureRandom.hex(32))).success?).to be(false)
    expect(AiExecutionStreamGrant.count).to eq(0)
  end

  it "redeems each capability once and permits a fresh read-only reconnect" do
    first = authorize.value.fetch(:token)
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: first).success?).to be(true)
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: first).success?).to be(false)
    second = authorize.value.fetch(:token)
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: second).success?).to be(true)
    expect(operation.reload.execution_count).to eq(1)
  end

  it "rechecks logout before redemption and every subsequent authorization check" do
    token = authorize.value.fetch(:token)
    granted = AiExecutions::StreamGrantService.call(action: "redeem", token: token).value
    browser_session.destroy!
    expect(AiExecutions::StreamGrantService.call(action: "check", grant_id: granted[:grant_id]).success?).to be(false)
    expect(authorize.success?).to be(false)
  end

  it "fences a superseded attempt and abandoned interview" do
    token = authorize.value.fetch(:token)
    operation.update!(claim_generation: operation.claim_generation + 1)
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: token).success?).to be(false)
    operation.update!(claim_generation: operation.claim_generation - 1)
    interview.update!(status: "abandoned")
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: token).success?).to be(false)
  end

  it "expires grants, disables issuance, and rejects unknown actions/features" do
    token = authorize.value.fetch(:token)
    AiExecutionStreamGrant.last.update!(expires_at: 1.second.ago)
    expect(AiExecutions::StreamGrantService.call(action: "redeem", token: token).success?).to be(false)
    expect(AiExecutions::StreamGrantService.call(action: "claim", token: token).success?).to be(false)
    expect(AiExecutions::AuthorizeStreamService.call(user: user, session_id: session_id,
      feature: "arbitrary_class", operation_id: operation.id).success?).to be(false)
    allow(ENV).to receive(:[]).with("AI_STREAMING_ENABLED").and_return("false")
    expect(authorize.success?).to be(false)
  end
end
