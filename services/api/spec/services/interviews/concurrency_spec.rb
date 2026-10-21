# Real committed records and independent connections exercise contested domain commits.
require "rails_helper"

RSpec.describe "Basic Interview concurrency" do
  # These scenarios exercise the retained provider-speech path explicitly.
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
  end

  self.use_transactional_tests = false

  before do
    @user = create(:user, email: "interview-race-#{SecureRandom.uuid}@example.com")
    @interview = Interviews::CreateFixtureService.call(user: @user).value
    @question = @interview.questions.first
  end

  after do
    media_ids = InterviewSessionMedia.where(interview_session: @interview).pluck(:id)
    @user&.destroy!
    # These synthetic rows never had storage objects. Remove only this example's
    # detached receipts after exercising real destruction, to isolate later specs.
    InterviewSessionMedia.where(id: media_ids).delete_all
  end

  def race
    ready, start = Queue.new, Queue.new
    threads = 2.times.map do |index|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          ready << connection.select_value("SELECT pg_backend_pid()")
          start.pop
          yield index
        end
      end
    end
    backends = 2.times.map { Timeout.timeout(10) { ready.pop } }
    expect(backends.uniq.size).to eq(2)
    2.times { start << true }
    Timeout.timeout(20) { threads.map(&:value) }
  ensure
    2.times { start << true } if start
    threads&.each(&:join)
  end

  def submit(key)
    Interviews::SubmitTurnService.call(interview: @user.interview_sessions.find(@interview.id),
      question_id: @question.id, recording_id: @recording_id, expected_revision: 0, submission_key: key)
  end

  it "serializes abandonment against turn acceptance on independent connections" do
    @recording_id = ready_interview_recording(@interview).id
    turn = submit("abandon-race").value
    claim = Interviews::ClaimOperationService.call(operation: turn).value
    results = race do |index|
      if index.zero?
        Interviews::AbandonService.call(interview: @user.interview_sessions.find(@interview.id))
      else
        Interviews::AcceptTurnService.call(operation: InterviewSessionOperation.find(turn.id),
          **claim.slice(:attempt_id, :claim_generation), transcript: "I calibrated it", decision: "continue",
          reply: "What changed?", history_version: 1, model_history: [])
      end
    end
    expect(results.first).to be_success
    expect(@interview.reload).to be_abandoned
    expect(@interview.messages.where(kind: "answer").count).to eq(results.last.success? ? 1 : 0)
    count = @interview.messages.count
    replay = Interviews::AcceptTurnService.call(operation: turn.reload,
      **claim.slice(:attempt_id, :claim_generation), transcript: "I calibrated it", decision: "continue",
      reply: "What changed?", history_version: 1, model_history: [])
    expect(replay.success?).to eq(results.last.success?)
    expect(@interview.messages.count).to eq(count)
    expect(Interviews::DiscoverOperationsService.call.value).to be_empty
  end

  it "serializes abandon against provider starts and retains any admitted unknown charge" do
    operation = @interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    observation_id = SecureRandom.uuid
    results = race do |index|
      if index.zero?
        Interviews::AbandonService.call(interview: @user.interview_sessions.find(@interview.id))
      else
        Interviews::StartProviderAttemptService.call(operation: InterviewSessionOperation.find(operation.id),
          **claim.slice(:attempt_id, :claim_generation), observation_id: observation_id,
          stage: "speech", provider: "fake", model: "fake")
      end
    end
    expect(results.first).to be_success
    expect(@interview.reload).to be_abandoned
    expect(operation.ai_task.ai_usage_attempts.where(attempt_id: observation_id).count).to eq(results.last.success? ? 1 : 0)
    expect(Interviews::StartProviderAttemptService.call(operation: operation,
      **claim.slice(:attempt_id, :claim_generation), observation_id: observation_id,
      stage: "speech", provider: "fake", model: "fake")).not_to be_success
  end

  it "begins reviewed preparation once across independent connections and replay" do
    @interview.destroy!
    @user.update!(summary: "Laboratory experience")
    @interview = Interviews::StartPreparationService.call(user: @user).value
    @interview.questions.create!(position: 0, content: "Explain calibration")
    @interview.update!(status: "ready", prepared_role: { title: "Fictional technician" }, revision: 1)
    results = race do
      Interviews::BeginService.call(interview: @user.interview_sessions.find(@interview.id))
    end
    expect(results).to all(be_success)
    expect(@interview.reload).to have_attributes(status: "active", revision: 2)
    expect(@interview.messages.pluck(:kind)).to eq([ "opening" ])
    expect(@interview.operations.speech.count).to eq(1)
    expect(Interviews::BeginService.call(interview: @interview)).to be_success
    expect(@interview.operations.speech.count).to eq(1)
  end

  it "accepts the capped response once and creates only one next opening" do
    @interview.destroy!
    @interview = Interviews::CreateFixtureService.call(user: @user, question_count: 2).value
    @interview.update!(answer_cap: 3)
    @question = @interview.questions.first
    @question.update!(accepted_answer_count: 2)
    @recording_id = ready_interview_recording(@interview).id
    turn = submit("cap-response").value
    turn.update!(status: "running", claim_generation: 1, attempt_id: SecureRandom.uuid,
      lease_expires_at: 30.seconds.from_now, execution_deadline: 2.minutes.from_now)
    results = race do
      Interviews::AcceptTurnService.call(operation: @interview.operations.find(turn.id),
        attempt_id: turn.attempt_id, claim_generation: 1, transcript: "I calibrated it",
        decision: "continue", reply: "Ignored at cap", history_version: 1, model_history: [])
    end
    expect(results).to all(be_success)
    expect(@interview.reload).to have_attributes(current_question_position: 1, revision: 1)
    expect(@question.reload.accepted_answer_count).to eq(3)
    opening = @interview.messages.where(question: @interview.questions.last, kind: "opening").sole
    expect(@interview.operations.speech.where(message: opening).count).to eq(1)
  end

  it "lets only one competing submission occupy the processing slot" do
    @recording_id = ready_interview_recording(@interview).id
    results = race { |index| submit("submission-#{index}") }
    expect(results.count(&:success?)).to eq(1)
    expect(@interview.operations.turn.count).to eq(1)
    expect(@question.reload.accepted_answer_count).to eq(0)
  end

  it "resolves simultaneous identical submissions to the same operation" do
    @recording_id = ready_interview_recording(@interview).id
    results = race { submit("same-submission") }
    expect(results).to all(be_success)
    expect(results.map { |result| result.value.id }.uniq.size).to eq(1)
    expect(@interview.operations.turn.count).to eq(1)
  end

  [ false, true ].each do |conflict|
    it "commits one result for #{conflict ? 'conflicting' : 'identical'} concurrent acceptance" do
      @recording_id = ready_interview_recording(@interview).id
      turn = submit("one-turn").value
      turn.update!(status: "running", claim_generation: 1, attempt_id: SecureRandom.uuid,
        lease_expires_at: 30.seconds.from_now, execution_deadline: 2.minutes.from_now)
      results = race do |index|
        operation = @user.interview_sessions.find(@interview.id).operations.find(turn.id)
        Interviews::AcceptTurnService.call(operation: operation, attempt_id: turn.attempt_id, claim_generation: 1,
          transcript: conflict ? "Answer #{index}" : "Same answer", decision: "advance", reply: nil,
          history_version: 1, model_history: [ { "kind" => "request", "parts" => [] } ])
      end
      expect(results.count(&:success?)).to eq(conflict ? 1 : 2)
      expect(@interview.reload).to have_attributes(status: "completed", revision: 1)
      expect(@question.reload.accepted_answer_count).to eq(1)
      expect(@interview.messages.pluck(:kind)).to eq(%w[opening answer closing])
      expect(@interview.operations.speech.count).to eq(2)
    end
  end
end

RSpec.describe "Interview claim concurrency" do
  # These scenarios exercise the retained provider-speech path explicitly.
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
  end

  self.use_transactional_tests = false
  it "assigns exactly one current execution across independent connections" do
    user = create(:user)
    interview = Interviews::CreateFixtureService.call(user: user).value
    operation_id = interview.operations.first.id
    ready, start = Queue.new, Queue.new
    threads = 2.times.map do
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do |connection|
          ready << connection.select_value("SELECT pg_backend_pid()")
          start.pop
          Interviews::ClaimOperationService.call(operation: InterviewSessionOperation.find(operation_id))
        end
      end
    end
    expect(2.times.map { Timeout.timeout(10) { ready.pop } }.uniq.length).to eq(2)
    2.times { start << true }
    results = Timeout.timeout(20) { threads.map(&:value) }
    expect(results.count(&:success?)).to eq(1)
    operation = interview.operations.find(operation_id)
    expect(operation.execution_count).to eq(1)
    expect(operation.execution_attempts.count).to eq(1)
    expect(user.ai_tasks.count).to eq(1)
  ensure
    2.times { start << true } if start
    threads&.each(&:join)
    user&.destroy!
  end
end
