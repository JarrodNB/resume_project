# Exercises reviewed text through submission, durable execution and acceptance without media.
require "rails_helper"

RSpec.describe "Typed interview answers" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:text) { "  I rebuilt the scheduler and verified duplicate jobs stopped.  " }
  let(:input) do
    { interview: interview, question_id: interview.questions.first.id, recording_id: nil,
      expected_revision: 0, submission_key: "typed-answer", candidate_transcript: text, transcription_mode: "typed" }
  end

  it "claims and accepts exactly reviewed text without a recording, once" do
    result = Interviews::SubmitTurnService.call(**input)
    expect(result).to be_success
    operation = result.value
    expect(operation.recording_id).to be_nil
    expect(operation.reload.delivery_job_id).to be_present
    claim = Interviews::ClaimOperationService.call(operation: operation)
    expect(claim).to be_success
    expect(claim.value.fetch(:payload)).to include(interview_id: interview.id, user_id: interview.user_id)
    expect(operation.reload).to have_attributes(candidate_transcript: text, recording_id: nil, transcription_mode: "typed")
    accepted = { operation: operation, **claim.value.slice(:attempt_id, :claim_generation), transcript: text,
      decision: "continue", reply: "How did you verify that?", history_version: 1, model_history: [] }
    2.times { expect(Interviews::AcceptTurnService.call(**accepted)).to be_success }
    expect(interview.reload.revision).to eq(1)
    expect(interview.messages.where(kind: "answer").pluck(:content)).to eq([ text ])
    expect(interview.questions.first.reload.accepted_answer_count).to eq(1)
    expect(operation.ai_task.ai_task_outcomes.pluck(:status)).to eq([ "completed" ])
    expect(Interviews::SubmitTurnService.call(**input).value.id).to eq(operation.id)
  end

  it "rejects changed text or a false digest under a reused identity" do
    first = Interviews::SubmitTurnService.call(**input)
    expect(first).to be_success
    expect(Interviews::SubmitTurnService.call(**input.merge(candidate_transcript: "A changed answer"))).not_to be_success
    expect(Interviews::SubmitTurnService.call(**input.merge(transcript_digest: "0" * 64))).not_to be_success
    digest = Digest::SHA256.hexdigest(text)
    expect(Interviews::SubmitTurnService.call(**input.merge(candidate_transcript: nil, transcript_digest: digest)).value.id).to eq(first.value.id)
    expect(first.value.reload.candidate_transcript).to eq(text)
  end

  [ nil, "", "   ", "x" * 4001 ].each do |invalid|
    it "rejects blank or oversized reviewed text before reserving work (#{invalid&.length})" do
      expect { expect(Interviews::SubmitTurnService.call(**input.merge(candidate_transcript: invalid))).not_to be_success }
        .not_to change { interview.operations.turn.count }
    end
  end

  it "requires audio in legacy modes and rejects attached media outside the owned session" do
    expect(Interviews::SubmitTurnService.call(**input.merge(transcription_mode: "browser"))).not_to be_success
    other = Interviews::CreateFixtureService.call(user: create(:user)).value
    recording = ready_interview_recording(other)
    expect(Interviews::SubmitTurnService.call(**input.merge(recording_id: recording.id))).not_to be_success
  end

  it "refuses acceptance that rewrites reviewed text and keeps the response slot available" do
    operation = Interviews::SubmitTurnService.call(**input).value
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    expect(Interviews::AcceptTurnService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      transcript: "Provider rewrote the user's answer.", decision: "advance", history_version: 1, model_history: [])).not_to be_success
    expect(interview.reload.revision).to eq(0)
    expect(interview.messages.where(kind: "answer")).to be_empty
  end

  it "does not accept text after its recovery lifetime even when the lease still has time" do
    freeze_time
    operation = Interviews::SubmitTurnService.call(**input).value
    travel 59.minutes + 59.seconds
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    travel 2.seconds
    expect(Interviews::AcceptTurnService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      transcript: text, decision: "advance", history_version: 1, model_history: [])).not_to be_success
    expect(interview.reload.revision).to eq(0)
  end

  it "recovers a failed text turn with the same bounded lease policy and expires it after an hour" do
    freeze_time
    operation = Interviews::SubmitTurnService.call(**input).value
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    expect(Interviews::FailOperationService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      code: "dependency_unavailable", retryable: true)).to be_success
    travel 3.seconds
    expect(operation.reload.delivery_job_id).to be_present
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    travel 1.hour
    Interviews::CleanupService.call(storage: instance_double(Interviews::MediaStorage, delete: nil))
    expect(operation.reload).to be_expired
    expect(operation.ai_task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
  end
end
