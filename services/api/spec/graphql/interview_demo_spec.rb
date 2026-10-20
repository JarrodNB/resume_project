# Exercises the owned public demo boundary without exposing execution internals.
require "rails_helper"

RSpec.describe "Spoken interview demo GraphQL" do
  let(:user) { create(:user) }
  let(:session) { Interviews::CreateFixtureService.call(user: user).value }
  let(:snapshot) { "id status revision questions { id content acceptedAnswerCount } messages { id content kind } operations { id status checkpoint failureCode }" }

  before do
    allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true)
  end

  it "creates a fictional interview with accepted opening and safe operation progress" do
    result = execute_graphql("mutation { startInterviewDemo(input: {}) { interview { #{snapshot} } errors } }", user: user)
    expect(result["errors"]).to be_nil
    payload = result.dig("data", "startInterviewDemo")
    expect(payload["errors"]).to eq([])
    expect(payload.dig("interview", "messages").size).to eq(1)
    expect(payload.dig("interview", "operations", 0, "status")).to eq("pending")
  end

  it "returns the owner snapshot and hides another owner's interview" do
    query = "query($id: ID!) { interviewSession(id: $id) { #{snapshot} } }"
    expect(execute_graphql(query, user: user, variables: { id: session.id })["errors"]).to be_nil
    result = execute_graphql(query, user: create(:user), variables: { id: session.id })
    expect(result.dig("errors", 0, "message")).to eq("Record not found")
  end

  it "rejects unauthenticated and feature-disabled operations" do
    query = "mutation { startInterviewDemo(input: {}) { errors } }"
    expect(execute_graphql(query, user: nil).dig("errors", 0, "message")).to eq("Authentication required")
    allow(Interviews::DemoAccess).to receive(:enabled?).and_return(false)
    expect(execute_graphql(query, user: user).dig("errors", 0, "message")).to eq("Interview demo unavailable")
  end

  it "keeps all recording, retry, submission, and playback actions owner-scoped" do
    actions = [
      [ "authorizeInterviewRecording", 'questionId: "00000000-0000-0000-0000-000000000000", expectedRevision: 0, contentType: "audio/wav", byteSize: 1, checksum: "aaaaaaaaaaaaaaaaaaaaaa=="' ],
      [ "registerInterviewRecording", 'mediaId: "00000000-0000-0000-0000-000000000000"' ],
      [ "submitInterviewTurn", 'questionId: "00000000-0000-0000-0000-000000000000", recordingId: "00000000-0000-0000-0000-000000000000", expectedRevision: 0, submissionKey: "test"' ],
      [ "retryInterviewOperation", 'operationId: "00000000-0000-0000-0000-000000000000"' ],
      [ "interviewPlayback", 'messageId: "00000000-0000-0000-0000-000000000000"' ]
    ]
    outsider = create(:user)
    actions.each do |name, arguments|
      query = "mutation { #{name}(input: {interviewId: \"#{session.id}\", #{arguments}}) { errors } }"
      expect(execute_graphql(query, user: outsider).dig("errors", 0, "message")).to eq("Record not found")
      allow(Interviews::DemoAccess).to receive(:enabled?).and_return(false)
      expect(execute_graphql(query, user: user).dig("errors", 0, "message")).to eq("Interview demo unavailable")
      allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true)
    end
  end

  it "hides expired dialogue before the cleanup job runs" do
    session.update!(expires_at: 1.second.ago)
    query = "query($id: ID!) { interviewSession(id: $id) { messages { content } } }"
    expect(execute_graphql(query, user: user, variables: { id: session.id }).dig("errors", 0, "message")).to eq("Interview expired")
    subscription = "subscription($id: ID!) { interviewSessionUpdated(id: $id) { id } }"
    result = ApiSchema.execute(subscription, variables: { id: session.id }, context: { current_user: user, channel: double("channel", stream_from: nil) }).to_h
    expect(result.dig("errors", 0, "message")).to eq("Interview expired")
  end

  it "offers retry only for recoverable, unexpired work with execution allowance" do
    operation = session.operations.speech.first
    operation.update!(status: "failed", execution_count: 3, retry_expires_at: 10.minutes.from_now, failure_code: "dependency_unavailable")
    query = "query($id: ID!) { interviewSession(id: $id) { operations { canRetry } } }"
    read = -> { execute_graphql(query, user: user, variables: { id: session.id }).dig("data", "interviewSession", "operations", 0, "canRetry") }
    expect(read.call).to be(true)
    %w[invalid_recording screening_blocked].each do |code|
      operation.update!(failure_code: code)
      expect(read.call).to be(false)
    end
    operation.update!(failure_code: "dependency_unavailable", execution_count: 6)
    expect(read.call).to be(false)
    operation.update!(execution_count: 3, retry_expires_at: 1.second.ago)
    expect(read.call).to be(false)
  end

  it "does not publish internal history or claim fields in the public schema" do
    %w[InterviewSession InterviewSessionQuestion InterviewSessionMessage InterviewSessionOperation].each do |name|
      fields = ApiSchema.types.fetch(name).fields.keys
      expect(fields & %w[modelHistory fixtureContext attemptId claimGeneration leaseExpiresAt acceptedResult recordingId]).to eq([])
    end
  end

  it "requires explicit enablement and development environment" do
    allow(Interviews::DemoAccess).to receive(:enabled?).and_call_original
    old = ENV["INTERVIEW_DEMO_ENABLED"]
    begin
      ENV["INTERVIEW_DEMO_ENABLED"] = "true"
      expect(Interviews::DemoAccess.enabled?).to be(false)
      allow(Rails.env).to receive(:development?).and_return(true)
      expect(Interviews::DemoAccess.enabled?).to be(true)
      ENV.delete("INTERVIEW_DEMO_ENABLED")
      expect(Interviews::DemoAccess.enabled?).to be(false)
    ensure
      ENV["INTERVIEW_DEMO_ENABLED"] = old
    end
  end
end

RSpec.describe "Interview snapshot subscriptions" do
  let(:user) { create(:user) }
  let(:session) { Interviews::CreateFixtureService.call(user: user).value }

  before { allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true) }

  it "returns a fresh accepted snapshot on reconnect and checks ownership" do
    query = "subscription($id: ID!) { interviewSessionUpdated(id: $id) { id revision messages { content } } }"
    channel = double("channel", stream_from: nil)
    first = ApiSchema.execute(query, variables: { id: session.id }, context: { current_user: user, channel: channel }).to_h
    expect(first["errors"]).to be_nil
    expect(first.dig("data", "interviewSessionUpdated", "revision")).to eq(0)
    session.update!(revision: 1)
    latest = ApiSchema.execute(query, variables: { id: session.id }, context: { current_user: user, channel: channel }).to_h
    expect(latest.dig("data", "interviewSessionUpdated", "revision")).to eq(1)
    denied = ApiSchema.execute(query, variables: { id: session.id }, context: { current_user: create(:user), channel: channel }).to_h
    expect(denied.dig("errors", 0, "message")).to eq("Record not found")
  end

  it "publishes speech attachment changes only after the transaction finishes" do
    operation = session.operations.speech.first
    expect(ApiSchema.subscriptions).to receive(:trigger).with(:interview_session_updated, { id: session.id }, an_instance_of(InterviewSession))
    InterviewSession.transaction(requires_new: true) do
      operation.update!(status: "accepted", accepted_at: Time.current, result_fingerprint: "speech-attachment", accepted_result: { "media_id" => SecureRandom.uuid })
    end
  end

  it "does not broadcast an operation that rolls back" do
    session
    expect(Interviews::PublishSnapshotService).not_to receive(:call)
    InterviewSession.transaction do
      session.update!(revision: 20)
      raise ActiveRecord::Rollback
    end
    expect(session.reload.revision).to eq(0)
  end
end
