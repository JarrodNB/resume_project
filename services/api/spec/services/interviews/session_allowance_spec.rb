# Exercises one hourly interview admission while each operation retains its own billing.
# All providers are local fakes; PostgreSQL owns the durable admission and execution slots.
require "rails_helper"

RSpec.describe "Prepared interview allowances" do
  let(:user) { create(:user, summary: "Maintain laboratory instruments") }
  before { stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1) }

  def prepare(owner = user, accounted: false)
    session = Interviews::StartPreparationService.call(user: owner).value
    operation = session.operations.preparation.first
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    record_provider(operation, "interviewer", "openai", "gpt-6-luna") if accounted
    expect(Interviews::AcceptPreparationService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation,
      role: { "title" => "Fictional technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] },
      questions: 9.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Instrument topic #{i}?" } })).to be_success
    expect(Interviews::BeginService.call(interview: session)).to be_success
    session
  end

  def record_provider(operation, stage, provider, model)
    identity = SecureRandom.uuid
    expect(Interviews::StartProviderAttemptService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, observation_id: identity, stage: stage, provider: provider, model: model)).to be_success
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: operation.attempt_id,
      observation_id: identity, usage: [ { "cost_microdollars" => 1 } ])).to be_success
    expect(Interviews::RecordUsageService.call(operation: operation, attempt_id: operation.attempt_id, usage: [])).to be_success
  end

  def complete_speech(session)
    speech = session.operations.speech.order(:created_at).last
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
    record_provider(speech, "speech", "openai", "gpt-4o-mini-tts")
    media = InterviewSessionMedia.create!(interview_session: session, question: speech.question, operation: speech,
      message: speech.message, kind: "speech", status: "ready", staging_key: "staging/#{SecureRandom.uuid}",
      sealed_key: "sealed/#{SecureRandom.uuid}", content_type: "audio/wav", byte_size: 100, checksum: "md5",
      attempt_id: speech.attempt_id, claim_generation: speech.claim_generation, expires_at: 1.hour.from_now)
    expect(Interviews::CompleteSpeechService.call(media: media, attempt_id: speech.attempt_id,
      claim_generation: speech.claim_generation)).to be_success
  end

  it "persists the preparation task before acknowledging the session and reuses it on claim" do
    result = Interviews::StartPreparationService.call(user: user)
    expect(result).to be_success
    operation = result.value.operations.preparation.first
    expect(operation.ai_task).to be_present
    expect(operation.ai_task).to have_attributes(task_type: "interview_preparation", user_id: user.id,
      subject: result.value, status: "queued")
    expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
    expect(user.ai_tasks.count).to eq(1)
  end

  it "admits opening speech using the session's existing hourly admission" do
    session = prepare
    speech = session.operations.speech.first
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
    expect(user.ai_tasks.count).to eq(2)
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: user)).to be_success
  end

  it "requires resuming or abandoning an unfinished prepared session before creating another" do
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 30)
    first = Interviews::StartPreparationService.call(user: user).value
    result = Interviews::StartPreparationService.call(user: user)
    expect(result.errors.join).to include("Resume or abandon")
    expect(user.interview_sessions.count).to eq(1)
    expect(Interviews::AbandonService.call(interview: first)).to be_success
    expect(Interviews::StartPreparationService.call(user: user)).to be_success
  end

  it "bounds new failed recordings without counting them as accepted answers" do
    session = prepare
    question = session.questions.first
    6.times do
      operation = Interviews::SubmitTurnService.call(interview: session, question_id: question.id,
        recording_id: ready_interview_recording(session).id, expected_revision: session.revision,
        submission_key: SecureRandom.uuid).value
      expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
      expect(Interviews::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id,
        claim_generation: operation.claim_generation, code: "invalid_recording", retryable: false)).to be_success
    end
    result = Interviews::SubmitTurnService.call(interview: session, question_id: question.id,
      recording_id: ready_interview_recording(session).id, expected_revision: session.revision,
      submission_key: SecureRandom.uuid)
    expect(result.errors.join).to include("submission limit")
    expect(session.operations.turn.count).to eq(6)
    expect(question.reload.accepted_answer_count).to eq(0)
  end

  it "conducts all 27 answers and 28 speeches under one hourly admission while retaining every bill" do
    session = prepare(accounted: true)
    complete_speech(session)
    27.times do
      question = session.questions.find_by!(position: session.reload.current_question_position)
      operation = Interviews::SubmitTurnService.call(interview: session, question_id: question.id,
        recording_id: ready_interview_recording(session, question: question).id,
        expected_revision: session.revision, submission_key: SecureRandom.uuid).value
      expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
      record_provider(operation, "transcription", "openai", "gpt-transcribe")
      record_provider(operation, "screening", "typesafe", "jev-1.13.0")
      record_provider(operation, "interviewer", "openai", "gpt-6-luna")
      expect(Interviews::AcceptTurnService.call(operation: operation, attempt_id: operation.attempt_id,
        claim_generation: operation.claim_generation, transcript: "I calibrated the instrument.", decision: "continue",
        reply: "Which checks did you use?", history_version: 1, model_history: [])).to be_success
      complete_speech(session.reload)
    end
    expect(session.reload).to be_completed
    expect(session.questions.pluck(:accepted_answer_count)).to eq([ 3 ] * 9)
    expect(user.ai_tasks.count).to eq(56)
    expect(user.ai_tasks.hourly_admissions.count).to eq(1)
    expect(user.ai_tasks.where.not(hourly_admission_task_id: nil).count).to eq(55)
    expect(user.ai_tasks).to all(be_completed)
    expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: user, interview: true).value.spent_microdollars).to eq(110)
    expect(InterviewVerificationReservation.sum(:actual_microdollars)).to eq(110)
    expect(Interviews::StartPreparationService.call(user: user).errors.join).to include("too many interview sessions")
  end

  it "keeps monthly spend and concurrency checks for child work" do
    session = prepare
    speech = session.operations.speech.first
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    blocker = create(:ai_task, user: user, task_type: "interview_turn")
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real").errors.join).to include("interview operations running")
    expect(speech.reload.ai_task).to be_failed
    blocker.update!(status: "completed")
    speech.ai_task.update!(cost_microdollars: 20)
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 20)
    expect(Interviews::RetryOperationService.call(operation: speech).errors.join).to include("month's interview usage")
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 21)
    expect(Interviews::RetryOperationService.call(operation: speech)).to be_success
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
  end

  it "preserves unknown-cost admission blocking for prepared stages" do
    session = prepare
    speech = session.operations.speech.first
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
    unknown = InterviewVerificationReservation.create!(observation_id: SecureRandom.uuid, reserved_microdollars: 250_000)
    expect(Interviews::StartProviderAttemptService.call(operation: speech, attempt_id: speech.attempt_id,
      claim_generation: speech.claim_generation, observation_id: SecureRandom.uuid, stage: "speech", provider: "openai",
      model: "gpt-4o-mini-tts")).not_to be_success
    expect(speech.reload).to have_attributes(status: "failed", failure_code: "ai_usage_limit_reached")
    expect(unknown.reload.actual_microdollars).to be_nil
    expect(InterviewVerificationReservation.count).to eq(1)
  end

  it "retains the existing task-month policy while new children account in their execution month" do
    travel_to Time.utc(2026, 10, 31, 23, 59) do
      session = prepare
      root = session.operations.preparation.first.ai_task
      root.update!(cost_microdollars: 100)
      travel 2.minutes
      speech = session.operations.speech.first
      expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
      speech.ai_task.update!(cost_microdollars: 20)
      expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: user, interview: true).value.spent_microdollars).to eq(20)
      expect(speech.ai_task.hourly_admission_task_id).to eq(root.id)
    end
  end

  it "rejects foreign or reparented child admission and permits account deletion without deleting the verification ledger" do
    session = prepare
    speech = session.operations.speech.first
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
    root = session.operations.preparation.first.ai_task
    foreign = create(:ai_task, user: create(:user))
    expect(user.ai_tasks.new(task_type: "interview_turn", subject: session, hourly_admission_task: foreign)).not_to be_valid
    expect { speech.ai_task.update!(hourly_admission_task_id: foreign.id) }.to raise_error(ActiveRecord::ReadonlyAttributeError)
    expect(speech.ai_task.reload.hourly_admission_task_id).to eq(root.id)
    reservation = InterviewVerificationReservation.create!(observation_id: SecureRandom.uuid, reserved_microdollars: 250_000)
    expect { user.destroy! }.not_to raise_error
    expect(reservation.reload.actual_microdollars).to be_nil
  end

  it "fails closed when a prepared session's admission is missing instead of treating it as a fixture" do
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 30)
    session = prepare
    session.operations.preparation.first.update!(ai_task: nil)
    speech = session.operations.speech.first
    result = Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")
    expect(result.errors.join).to include("admission is invalid")
    expect(speech.reload.ai_task).to be_nil
    expect(speech.execution_attempts).to be_empty
  end

  it "checks preparation's admission purpose before granting execution" do
    session = Interviews::StartPreparationService.call(user: user).value
    preparation = session.operations.first
    preparation.ai_task.update!(input: { operation_id: SecureRandom.uuid })
    result = Interviews::ClaimOperationService.call(operation: preparation, execution_mode: "real")
    expect(result.errors.join).to include("admission is invalid")
    expect(preparation.execution_attempts).to be_empty
  end

  it "rejects terminal sessions before a shared allowance check can create child tasks" do
    session = prepare
    speech = session.operations.speech.first
    expect(Interviews::AbandonService.call(interview: session)).to be_success
    expect do
      result = Interviews::CheckOperationAllowanceService.call(operation: speech, create_task: true)
      expect(result.errors.join).to include("no longer available")
    end.not_to change(AiTask, :count)
  end

  it "does not exclude the admission root from another operation's in-flight checks" do
    session = prepare
    session.operations.preparation.first.ai_task.update!(status: "queued")
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    result = Interviews::ClaimOperationService.call(operation: session.operations.speech.first, execution_mode: "real")
    expect(result.errors.join).to include("interview operations running")
  end
end
