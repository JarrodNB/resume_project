# Competes independent PostgreSQL connections for prepared-session and execution admission.
require "rails_helper"

RSpec.describe "Prepared interview admission contention" do
  # These scenarios exercise the retained provider-speech path explicitly.
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
  end

  self.use_transactional_tests = false

  before { @user = create(:user, summary: "Maintain instruments", ai_tasks_per_hour_limit: 30) }
  after do
    media_ids = InterviewSessionMedia.where(interview_session_id: @user.interview_sessions.select(:id)).pluck(:id)
    @user.destroy!
    InterviewSessionMedia.where(id: media_ids).delete_all
  end

  def compete
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
    expect(2.times.map { Timeout.timeout(10) { ready.pop } }.uniq.size).to eq(2)
    2.times { start << true }
    Timeout.timeout(20) { threads.map(&:value) }
  ensure
    2.times { start << true } if start
    threads&.each(&:join)
  end

  it "admits only one competing start at the hourly limit" do
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    results = compete { Interviews::StartPreparationService.call(user: User.find(@user.id)) }
    expect(results.count(&:success?)).to eq(1)
    expect(@user.interview_sessions.count).to eq(1)
    expect(@user.ai_tasks.hourly_admissions.count).to eq(1)
  end

  it "admits only one competing stage at the owner's in-flight limit" do
    session = Interviews::StartPreparationService.call(user: @user).value
    preparation = session.operations.first
    expect(Interviews::ClaimOperationService.call(operation: preparation, execution_mode: "real")).to be_success
    expect(Interviews::AcceptPreparationService.call(operation: preparation, attempt_id: preparation.attempt_id,
      claim_generation: preparation.claim_generation,
      role: { "title" => "Fictional technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] },
      questions: 8.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Instrument topic #{i}?" } })).to be_success
    expect(Interviews::BeginService.call(interview: session)).to be_success
    turn = Interviews::SubmitTurnService.call(interview: session, question_id: session.questions.first.id,
      recording_id: ready_interview_recording(session).id, expected_revision: session.revision, submission_key: "contended").value
    ids = [ session.operations.speech.first.id, turn.id ]
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    results = compete do |index|
      Interviews::ClaimOperationService.call(operation: InterviewSessionOperation.find(ids[index]), execution_mode: "real")
    end
    expect(results.count(&:success?)).to eq(1)
    expect(@user.ai_tasks.queued.count).to eq(1)
    expect(InterviewSessionOperation.where(id: ids, status: "failed", failure_code: "ai_usage_limit_reached").count).to eq(1)
    expect(InterviewExecutionAttempt.where(operation_id: ids).count).to eq(1)
  end
end
