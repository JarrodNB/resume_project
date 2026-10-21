# Budget rejection must stop discovery without consuming an answer or expiring its recording.
require "rails_helper"

RSpec.describe "Interview provider admission recovery" do
  [ :unknown, :exhausted, :owner_limit ].each do |reason|
    it "saves an actionable failure and preserves explicit retry after #{reason} denial" do
      interview = Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value
      recording = ready_interview_recording(interview)
      operation = Interviews::SubmitTurnService.call(interview: interview, question_id: interview.questions.first.id,
        recording_id: recording.id, expected_revision: interview.revision, submission_key: SecureRandom.uuid).value
      expect(Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")).to be_success
      expiry = recording.expires_at
      if reason == :owner_limit
        interview.user.update!(monthly_ai_budget_microdollars: 0)
      else
        InterviewVerificationReservation.create!(observation_id: SecureRandom.uuid, reserved_microdollars: 5_000_000,
          actual_microdollars: reason == :unknown ? nil : 5_000_000)
      end
      expect do
        result = Interviews::StartProviderAttemptService.call(operation: operation, attempt_id: operation.attempt_id,
          claim_generation: operation.claim_generation, observation_id: SecureRandom.uuid,
          stage: "transcription", provider: "openai", model: "gpt-transcribe")
        expect(result).not_to be_success
      end.not_to change(InterviewProviderAttempt, :count)
      expect(operation.reload).to have_attributes(status: "failed", failure_code: "ai_usage_limit_reached", retry_at: nil)
      expect(operation.ai_task.reload).to have_attributes(status: "failed", error_message: "ai_usage_limit_reached")
      expect(recording.reload.expires_at).to eq(expiry)
      expect(Interviews::RetryEligibilityService.call(operation: operation)).to be_success
      expect(interview.questions.first.reload.accepted_answer_count).to eq(0)
      expect(InterviewVerificationReservation.where(actual_microdollars: nil).count).to eq(reason == :unknown ? 1 : 0)
    end
  end
end
