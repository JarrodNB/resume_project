# Exercises the owned public demo boundary without exposing execution internals.
require "rails_helper"

RSpec.describe "Spoken interview demo GraphQL" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  let(:session) { Interviews::CreateFixtureService.call(user: user).value }
  let(:snapshot) { "id status executionMode speechPlaybackMode revision questions { id content acceptedAnswerCount } messages { id content kind } operations { id status checkpoint failureCode }" }

  before do
    allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true)
  end

  it "queues recorded review only for its owner and exposes a transcript only while current and live" do
    recording = ready_interview_recording(session)
    mutation = 'mutation($input: StartRecordedTranscriptionInput!) { startRecordedTranscription(input: $input) { operationId interview { revision } errors } }'
    variables = { input: { interviewId: session.id, questionId: session.questions.first.id, expectedRevision: 0, recordingId: recording.id } }
    expect(execute_graphql(mutation, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
    result = execute_graphql(mutation, user: user, variables: variables)
    expect(result.dig("data", "startRecordedTranscription", "errors")).to eq([])
    operation = session.operations.transcription.find(result.dig("data", "startRecordedTranscription", "operationId"))
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    Interviews::AcceptTranscriptionService.call(operation: operation, attempt_id: claim[:attempt_id], claim_generation: claim[:claim_generation], transcript: "Private capture text")
    query = "query { interviewSession(id: \"#{session.id}\") { operations { kind reviewTranscript } } }"
    read = -> { execute_graphql(query, user: user).dig("data", "interviewSession", "operations").find { |item| item["kind"] == "transcription" }["reviewTranscript"] }
    expect(read.call).to eq("Private capture text")
    expect(execute_graphql(query, user: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
    session.update!(revision: 1)
    expect(read.call).to be_nil
    session.update!(revision: 0)
    recording.update!(expires_at: 1.second.ago)
    expect(read.call).to be_nil
  end

  it "requests only an owned latest prompt and restores saved clarification metadata" do
    current = Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
    mutation = 'mutation($input: RequestInterviewClarificationInput!) { requestInterviewClarification(input: $input) { clarification { id status explanation attemptCount aiTaskId deadline } errors } }'
    variables = { input: { interviewId: current.id, messageId: current.messages.first.id } }
    expect(execute_graphql(mutation, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
    result = execute_graphql(mutation, user: user, variables: variables)
    expect(result["errors"]).to be_nil
    record = current.clarifications.first!
    expect(result.dig("data", "requestInterviewClarification", "clarification", "aiTaskId")).to eq(record.ai_task_id)
    query = "{ interviewSession(id: \"#{current.id}\") { messages { clarification { id status } } } }"
    expect(execute_graphql(query, user: user).dig("data", "interviewSession", "messages", 0, "clarification", "id")).to eq(record.id)
    Interviews::ClaimClarificationService.call(ai_task: record.ai_task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => record.ai_task_id, "status" => "completed", "result" => { "explanation" => "Explain the question in simpler words." } })
    current.update!(expires_at: 1.second.ago)
    task_query = "{ aiTask(id: \"#{record.ai_task_id}\") { input result } }"
    expect(execute_graphql(task_query, user: user).dig("data", "aiTask")).to eq("input" => {}, "result" => nil)
    expect(execute_graphql(task_query, user: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
  end

  it "submits reviewed text without audio only into the owner's current interview" do
    mutation = 'mutation($input: SubmitInterviewTurnInput!) { submitInterviewTurn(input: $input) { interview { id } errors } }'
    variables = { input: { interviewId: session.id, questionId: session.questions.first.id, expectedRevision: 0,
      submissionKey: "typed-graphql", transcriptionMode: "typed", candidateTranscript: "I rebuilt the scheduler." } }
    expect(execute_graphql(mutation, user: create(:user), variables: variables).dig("errors", 0, "message")).to eq("Record not found")
    result = execute_graphql(mutation, user: user, variables: variables)
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "submitInterviewTurn", "errors")).to eq([])
    expect(session.operations.turn.first).to have_attributes(recording_id: nil, candidate_transcript: "I rebuilt the scheduler.")
  end

  it "exposes separate acknowledgement and canonical spoken text only in the owned snapshot" do
    message = session.messages.first
    message.update!(acknowledgement: "You improved the booking process.")
    query = "query { interviewSession(id: \"#{session.id}\") { messages { content acknowledgement spokenContent } } }"
    result = execute_graphql(query, user: user)
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "interviewSession", "messages", 0)).to eq(
      "content" => message.content, "acknowledgement" => message.acknowledgement,
      "spokenContent" => "#{message.acknowledgement}\n\n#{message.content}")
    expect(execute_graphql(query, user: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
  end

  it "lists only the owner's twenty most recent live real sessions across resumable and review states" do
    config = Interviews::ExecutionConfiguration::PRESETS.fetch("real")
    sessions = 22.times.map do |index|
      user.interview_sessions.create!(status: %w[preparing ready active completed][index % 4],
        execution_mode: "real", execution_config: config, expires_at: 1.day.from_now,
        created_at: index.minutes.ago)
    end
    session # legacy scripted fixture is deliberately excluded
    user.interview_sessions.create!(status: "abandoned", execution_mode: "real", execution_config: config, expires_at: 1.day.from_now)
    user.interview_sessions.create!(status: "active", execution_mode: "real", execution_config: config, expires_at: 1.second.ago)
    create(:user).interview_sessions.create!(status: "active", execution_mode: "real", execution_config: config, expires_at: 1.day.from_now)
    result = execute_graphql("{ recentInterviewSessions { id status createdAt currentQuestionPosition questions { id } } }", user: user)
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "recentInterviewSessions").map { |row| row["id"] }).to eq(sessions.first(20).map(&:id))
    expect(execute_graphql("{ recentInterviewSessions { id } }", user: nil).dig("errors", 0, "message")).to eq("Authentication required")
  end

  it "abandons only owned unfinished sessions and returns an idempotent terminal snapshot" do
    query = "mutation { abandonInterview(input: {interviewId: \"#{session.id}\"}) { interview { id status revision } errors } }"
    expect(execute_graphql(query, user: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
    first = execute_graphql(query, user: user)
    expect(first["errors"]).to be_nil
    expect(first.dig("data", "abandonInterview", "interview", "status")).to eq("abandoned")
    expect(execute_graphql(query, user: user)).to eq(first)
  end

  it "starts owned preparation without opening speech and safe operation progress" do
    allow(Interviews::DemoAccess).to receive(:real_enabled?).and_return(true)
    allow(Interviews::RealRuntimeReadiness).to receive(:ready?).and_return(true)
    result = execute_graphql("mutation { startInterviewDemo(input: {}) { interview { #{snapshot} } errors } }", user: user)
    expect(result["errors"]).to be_nil
    payload = result.dig("data", "startInterviewDemo")
    expect(payload["errors"]).to eq([])
    expect(payload.dig("interview", "executionMode")).to eq("real")
    expect(payload.dig("interview", "speechPlaybackMode")).to eq("browser")
    expect(payload.dig("interview", "messages")).to be_empty
    expect(payload.dig("interview", "status")).to eq("preparing")
    expect(payload.dig("interview", "operations", 0, "status")).to eq("pending")
  end

  it "begins only the owner's reviewed interview and returns the active snapshot" do
    session.update!(status: "ready")
    session.operations.destroy_all
    session.messages.destroy_all
    query = "mutation { beginInterview(input: {interviewId: \"#{session.id}\"}) { interview { #{snapshot} } errors } }"
    expect(execute_graphql(query, user: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
    result = execute_graphql(query, user: user)
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "beginInterview", "interview", "status")).to eq("active")
    expect(result.dig("data", "beginInterview", "interview", "messages").length).to eq(1)
  end

  it "rejects scripted creation even when a legacy client explicitly requests it" do
    result = execute_graphql('mutation { startInterviewDemo(input: {executionMode: "fake"}) { interview { id } errors } }', user: user)
    expect(result.dig("data", "startInterviewDemo", "interview")).to be_nil
    expect(result.dig("data", "startInterviewDemo", "errors").join).to include("Scripted interviews are retired")
    expect(user.interview_sessions.count).to eq(0)
  end


  it "creates real only with explicit development admission and keeps saved mode after disabling" do
    allow(Interviews::DemoAccess).to receive(:real_enabled?).and_return(true)
    allow(Interviews::RealRuntimeReadiness).to receive(:ready?).and_return(true)
    query = 'mutation { startInterviewDemo(input: {executionMode: "real"}) { interview { id executionMode } errors } }'
    result = execute_graphql(query, user: user)
    expect(result["errors"]).to be_nil
    real = result.dig("data", "startInterviewDemo", "interview")
    expect(real["executionMode"]).to eq("real")
    allow(Interviews::DemoAccess).to receive(:real_enabled?).and_return(false)
    expect(execute_graphql(query, user: user).dig("data", "startInterviewDemo", "errors")).to include("Interview service is unavailable. Check the interview runtime and admission settings.")
    expect(execute_graphql("query { interviewSession(id: \"#{real['id']}\") { executionMode } }", user: user).dig("data", "interviewSession", "executionMode")).to eq("real")
    expect(Types::InterviewSessionType.fields.keys).not_to include("executionConfig")
  end

  it "fails new real admission actionably when its runtime is unavailable" do
    allow(Interviews::DemoAccess).to receive(:real_enabled?).and_return(true)
    allow(Interviews::RealRuntimeReadiness).to receive(:ready?).and_return(false)
    result = execute_graphql('mutation { startInterviewDemo(input: {executionMode: "real"}) { interview { id } errors } }', user: user)
    expect(result.dig("data", "startInterviewDemo", "interview")).to be_nil
    expect(result.dig("data", "startInterviewDemo", "errors").join).to include("runtime readiness")
    expect(user.interview_sessions.count).to eq(0)
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
    expect(execute_graphql(query, user: user).dig("errors", 0, "message")).to eq("Interviews unavailable in this environment")
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
      expect(execute_graphql(query, user: user).dig("errors", 0, "message")).to eq("Interviews unavailable in this environment")
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

  it "allows interview access without the retired demo flag" do
    allow(Interviews::DemoAccess).to receive(:enabled?).and_call_original
    expect(Interviews::DemoAccess.enabled?).to be(true)
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

RSpec.describe "Spoken preparation GraphQL privacy" do
  it "saves selected length and restores it through the owned public snapshot" do
    allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true)
    allow(Interviews::DemoAccess).to receive(:real_enabled?).and_return(true)
    allow(Interviews::RealRuntimeReadiness).to receive(:ready?).and_return(true)
    owner = create(:user, summary: "Private laboratory facts")
    invalid = execute_graphql('mutation { startInterviewDemo(input: {setup: {questionCount: 6}}) { interview { id } errors } }', user: owner)
    expect(invalid.dig("data", "startInterviewDemo", "interview")).to be_nil
    expect(owner.interview_sessions).to be_empty
    invalid_format = execute_graphql('mutation { startInterviewDemo(input: {setup: {questionCount: 5, questionFormat: "unknown"}}) { interview { id } errors } }', user: owner)
    expect(invalid_format.dig("data", "startInterviewDemo", "interview")).to be_nil
    expect(owner.interview_sessions).to be_empty
    result = execute_graphql('mutation { startInterviewDemo(input: {setup: {questionCount: 12, questionFormat: "screening", difficulty: "stretch", interviewer: "priya", focusAreas: ["leadership"]}}) { interview { id setup { questionCount questionFormat difficulty interviewer focusAreas } } errors } }', user: owner)
    payload = result.dig("data", "startInterviewDemo")
    expect(payload.fetch("errors")).to be_empty
    expect(payload.dig("interview", "setup", "questionCount")).to eq(12)
    expect(payload.dig("interview", "setup", "questionFormat")).to eq("screening")
    expect(payload.dig("interview", "setup")).to include("difficulty" => "stretch", "interviewer" => "priya", "focusAreas" => [ "leadership" ])
    id = payload.dig("interview", "id")
    restored = execute_graphql("query { interviewSession(id: \"#{id}\") { setup { questionCount questionFormat difficulty interviewer focusAreas } } }", user: owner)
    expect(restored.dig("data", "interviewSession", "setup", "questionCount")).to eq(12)
    expect(restored.dig("data", "interviewSession", "setup", "questionFormat")).to eq("screening")
    expect(restored.dig("data", "interviewSession", "setup")).to eq(payload.dig("interview", "setup"))
    expect(execute_graphql("query { interviewSession(id: \"#{id}\") { setup { questionCount } } }", user: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
  end

  it "exposes owned role progress but never raw frozen sources or another owner's session" do
    allow(Interviews::DemoAccess).to receive(:enabled?).and_return(true)
    allow(Interviews::DemoAccess).to receive(:real_enabled?).and_return(true)
    allow(Interviews::RealRuntimeReadiness).to receive(:ready?).and_return(true)
    owner = create(:user, summary: "Private laboratory facts")
    result = execute_graphql('mutation { startInterviewDemo(input: {careerFocus: "laboratory"}) { interview { id status preparedRole operations { kind questionId } } errors } }', user: owner)
    payload = result.dig("data", "startInterviewDemo")
    expect(payload["errors"]).to be_empty
    expect(payload.dig("interview", "operations", 0, "questionId")).to be_nil
    expect(payload.dig("interview", "preparedRole")).to eq({})
    expect(result.to_json).not_to include("Private laboratory facts")
    id = payload.dig("interview", "id")
    expect(execute_graphql("query { interviewSession(id: \"#{id}\") { preparedRole } }", user: create(:user)).dig("errors", 0, "message")).to eq("Record not found")
    expect(Types::InterviewSessionType.fields.keys).not_to include("frozenContext")
  end
end
