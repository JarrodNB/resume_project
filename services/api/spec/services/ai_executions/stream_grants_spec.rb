# Stream grants authorize observers without claiming or restarting paid execution.
require "rails_helper"

RSpec.describe "AI execution stream grants" do
  include ActiveJob::TestHelper
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

  it "keeps observer and session digests outside the AI reader role" do
    expect(ApplicationRecord.connection.select_value(
      "SELECT has_table_privilege('ai_reader', 'ai_execution_stream_grants', 'SELECT')")).to be(false)
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

  it "bounds active capabilities without preventing expired-grant cleanup" do
    8.times { expect(authorize.success?).to be(true) }
    expect(authorize.success?).to be(false)
    AiExecutionStreamGrant.update_all(expires_at: 1.minute.ago)
    AiExecutions::PruneStreamGrantsService.call
    expect(AiExecutionStreamGrant.count).to eq(0)
    expect(authorize.success?).to be(true)
  end

  it "catches up expired credential batches while retaining live grants" do
    authorize
    live = AiExecutionStreamGrant.last
    rows = 501.times.map do
      live.attributes.except("id").merge("token_digest" => SecureRandom.hex(32), "expires_at" => 1.minute.ago)
    end
    AiExecutionStreamGrant.insert_all!(rows)
    perform_enqueued_jobs(only: AiExecutions::PruneStreamGrantsJob) do
      AiExecutions::PruneStreamGrantsJob.perform_later
    end
    expect(AiExecutionStreamGrant.pluck(:id)).to eq([ live.id ])
  end
end
