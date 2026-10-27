# Verify ordinary interview actions reserve durable delivery without a discovery pass.
require "rails_helper"

RSpec.describe "Interview delivery cutover" do
  include ActiveJob::TestHelper
  before { allow(AiExecutions::NudgeService).to receive(:call).and_return(ServiceResult.new(success: true, value: true, errors: [])) }

  def fixture(**options)
    Interviews::CreateFixtureService.call(user: create(:user), **options).value
  end

  def typed_turn(interview)
    Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
      expected_revision: interview.revision, submission_key: SecureRandom.uuid,
      candidate_transcript: "I made retries safe with stable request identities.", transcription_mode: "typed").value
  end

  it "dispatches a submitted text turn once, with its committed operation identity" do
    interview = fixture
    clear_enqueued_jobs
    operation = typed_turn(interview)
    expect(operation.delivery_job_id).to be_present
    expect(AiExecutions::DispatchJob).to have_been_enqueued.with("interviews", operation.id)
  end
  it "dispatches recorded transcription once across repeated review requests" do
    interview = fixture
    recording = ready_interview_recording(interview)
    input = { interview: interview, question_id: interview.questions.first.id,
      expected_revision: interview.revision, recording_id: recording.id }
    first = Interviews::StartRecordedTranscriptionService.call(**input).value
    count = enqueued_jobs.count
    expect(Interviews::StartRecordedTranscriptionService.call(**input).value.id).to eq(first.id)
    expect(first.delivery_job_id).to be_present
    expect(enqueued_jobs.count).to eq(count)
    expect(AiExecutions::DispatchJob).to have_been_enqueued.with("interviews", first.id)
  end

  it "dispatches fixture opening speech for offline recovery through the same path" do
    operation = fixture.operations.speech.first
    expect(operation.delivery_job_id).to be_present
    expect(AiExecutions::DispatchJob).to have_been_enqueued.with("interviews", operation.id)
  end

  it "dispatches beginning provider speech once across repeated begin requests" do
    interview = Interviews::StartPreparationService.call(user: create(:user, summary: "I maintain inventory systems.")).value
    interview.questions.create!(content: "How did you improve reliability?", position: 0)
    interview.update!(status: "ready")
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
    expect(Interviews::BeginService.call(interview: interview)).to be_success
    count = enqueued_jobs.count
    expect(Interviews::BeginService.call(interview: interview)).to be_success
    operation = interview.operations.speech.first
    expect(operation.delivery_job_id).to be_present
    expect(enqueued_jobs.count).to eq(count)
  end

  it "dispatches accepted response speech once without repeating accepted dialogue" do
    interview = fixture
    operation = typed_turn(interview)
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    input = { operation: operation, **claim.slice(:attempt_id, :claim_generation),
      transcript: operation.candidate_transcript, decision: "continue", reply: "How did you verify the change?",
      history_version: 1, model_history: [] }
    first = Interviews::AcceptTurnService.call(**input)
    expect(first).to be_success
    count = enqueued_jobs.count
    expect(Interviews::AcceptTurnService.call(**input)).to be_success
    speech = interview.operations.speech.find_by!(message_id: first.value.fetch("message_ids").last)
    expect(speech.delivery_job_id).to be_present
    expect(enqueued_jobs.count).to eq(count)
    expect(interview.messages.answer.count).to eq(1)
  end

  it "dispatches the next question's speech once when skipping" do
    interview = fixture(question_count: 2)
    input = { interview: interview, question_id: interview.questions.first.id,
      expected_revision: interview.revision, submission_key: "skip-delivery" }
    expect(Interviews::SkipQuestionService.call(**input)).to be_success
    count = enqueued_jobs.count
    expect(Interviews::SkipQuestionService.call(**input)).to be_success
    speech = interview.operations.speech.find_by!(question: interview.questions.order(:position).last)
    expect(speech.delivery_job_id).to be_present
    expect(enqueued_jobs.count).to eq(count)
  end

  it "persists a successor dispatch at automatic retry time for an answer" do
    operation = typed_turn(fixture)
    prior_delivery = operation.delivery_job_id
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    expect(Interviews::FailOperationService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      code: "dependency_unavailable", retryable: true)).to be_success
    expect(operation.reload).to be_pending
    expect(operation.delivery_job_id).not_to eq(prior_delivery)
    expect(enqueued_jobs.find { |job| job["job_id"] == operation.delivery_job_id }.fetch(:at)).to be_within(0.01).of(operation.retry_at.to_f)
  end

  it "opens explicit answer retry with a new dispatch and the existing execution count" do
    operation = typed_turn(fixture)
    prior_delivery = operation.delivery_job_id
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    expect(Interviews::FailOperationService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      code: "dependency_unavailable", retryable: false)).to be_success
    expect(Interviews::RetryOperationService.call(operation: operation)).to be_success
    expect(operation.reload).to have_attributes(status: "pending", cycle_execution_count: 0, execution_count: 1)
    expect(operation.delivery_job_id).not_to eq(prior_delivery)
  end

  it "expires an answer's one-hour recovery window through maintenance without discovery" do
    operation = typed_turn(fixture)
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    task = operation.reload.ai_task
    travel 1.hour + 1.second
    Interviews::CleanupService.call(storage: instance_double(Interviews::MediaStorage, delete: nil))
    expect(operation.reload).to be_expired
    expect(task.reload).to have_attributes(status: "failed", error_message: "media_expired")
    expect(task.ai_usage_attempts.count).to eq(1)
  end

end
