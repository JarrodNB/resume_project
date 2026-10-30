# Checks preparation persists commands rather than copies of saved source records.
require "rails_helper"

RSpec.describe "Reference-only interview inputs" do
  let(:user) { create(:user, summary: "Career evidence") }

  it "stores only preparation choices and returns identity-only execution claims" do
    job = create(:job, user: user, description: "x" * 20_000)
    interview = Interviews::StartPreparationService.call(user: user, job: job, career_focus: "engineering").value
    expect(interview).to be_present
    expect(interview).not_to respond_to(:frozen_context)
    expect(interview.career_focus).to eq("engineering")
    expect(interview.preparation_kind).to eq("saved_job")
    claim = Interviews::ClaimOperationService.call(operation: interview.operations.first, execution_mode: "real")
    expect(claim).to be_success
    expect(claim.value.fetch(:payload).keys).to match_array([ :version, :interview_id, :user_id, :setup ])
  end
  %w[turn transcription speech].each do |kind|
    it "returns the exact identity contract for #{kind}, without copied saved or fresh text" do
      interview = Interviews::CreateFixtureService.call(user: user).value
      question = interview.questions.first
      question.update!(content: "PRIVATE PREPARED QUESTION")
      interview.messages.first.update!(content: "PRIVATE ACCEPTED DIALOGUE")
      operation = case kind
      when "speech" then interview.operations.speech.first
      when "transcription"
        Interviews::StartRecordedTranscriptionService.call(interview: interview, question_id: question.id,
          expected_revision: 0, recording_id: ready_interview_recording(interview).id).value
      else
        Interviews::SubmitTurnService.call(interview: interview, question_id: question.id, expected_revision: 0,
          submission_key: "identity", transcription_mode: "typed", candidate_transcript: "PRIVATE FRESH COMMAND").value
      end
      result = Interviews::ClaimOperationService.call(operation: operation)
      expect(result).to be_success
      expect(result.value.keys).to match_array(%i[execution_mode execution_config operation_id kind attempt_id claim_generation lease_expires_at execution_deadline payload])
      expect(result.value[:payload]).to eq(version: 1, interview_id: interview.id, user_id: user.id,
        setup: Interviews::SetupConfiguration.for(interview))
      expect(result.value.to_json).not_to include("PRIVATE")
    end
  end
end

RSpec.describe "Saved-job interview preparation readiness" do
  it "retains its saved-job role contract after the original job is deleted" do
    user = create(:user, summary: "Career evidence")
    job = create(:job, user: user)
    interview = Interviews::StartPreparationService.call(user: user, job: job).value
    operation = interview.operations.first
    identity = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real").value.slice(:attempt_id, :claim_generation)
    job.destroy!
    interview.reload
    questions = 8.times.map { |i| { "content" => "Question #{i}?", "question_type" => %w[behavioral technical knowledge][i % 3] } }
    expect(Interviews::AcceptPreparationService.call(operation: operation, **identity, role: nil, questions: questions)).to be_success
    expect(interview.reload).to have_attributes(preparation_kind: "saved_job", prepared_role: {}, job_id: nil)
    expect(Interviews::BeginService.call(interview: interview)).to be_success
  end
end
