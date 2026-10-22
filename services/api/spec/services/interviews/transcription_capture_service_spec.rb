# Exercise owned live transcription admission and immutable completion without provider I/O.
require "rails_helper"

RSpec.describe "Live interview transcription captures" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value }
  let(:input) { { interview: interview, question_id: interview.questions.first.id, expected_revision: 0 } }

  it "issues one owned capability and admits one paid connection before microphone upload" do
    result = Interviews::AuthorizeTranscriptionService.call(**input)
    expect(result).to be_success
    grant = result.value
    expect(grant[:token]).to be_present
    admitted = Interviews::TranscriptionCaptureService.call(action: "redeem", token: grant[:token])
    expect(admitted).to be_success
    capture = InterviewTranscriptionCapture.find(grant[:capture_id])
    expect(capture.status).to eq("streaming")
    expect(capture.ai_task.ai_usage_attempts.find_by!(attempt_id: capture.observation_id)).to be_incomplete
    expect(InterviewVerificationReservation.find_by!(observation_id: capture.observation_id).actual_microdollars).to be_nil
    expect(Interviews::TranscriptionCaptureService.call(action: "redeem", token: grant[:token])).not_to be_success
  end
end

RSpec.describe "Live capture recovery and accounting" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value }
  let(:input) { { interview: interview, question_id: interview.questions.first.id, expected_revision: 0 } }
  def capture
    @capture ||= begin
      grant = Interviews::AuthorizeTranscriptionService.call(**input).value
      Interviews::TranscriptionCaptureService.call(action: "redeem", token: grant[:token])
      InterviewTranscriptionCapture.find(grant[:capture_id])
    end
  end

  it "persists final text once and reconciles the actual receipt without charging twice" do
    usage = { "audio_milliseconds" => 1000, "cost_microdollars" => 284 }
    args = { action: "finish", capture_id: capture.id, transcript: "My answer", usage: usage }
    expect(Interviews::TranscriptionCaptureService.call(**args)).to be_success
    expect(Interviews::TranscriptionCaptureService.call(**args)).to be_success
    expect(capture.reload.transcript).to eq("My answer")
    expect(capture.ai_task.reload.cost_microdollars).to eq(284)
    expect(Interviews::TranscriptionCaptureService.call(**args.merge(transcript: "Changed"))).not_to be_success
  end

  it "preserves unknown cost after disconnect and can reconcile a late receipt" do
    args = { action: "fail", capture_id: capture.id }
    expect(Interviews::TranscriptionCaptureService.call(**args)).to be_success
    expect(capture.ai_task.ai_usage_attempts.find_by!(attempt_id: capture.observation_id)).to be_incomplete
    expect(Interviews::TranscriptionCaptureService.call(**args.merge(usage: { "audio_milliseconds" => 1000, "cost_microdollars" => 284 }))).to be_success
    expect(capture.ai_task.reload.cost_microdollars).to eq(284)
  end

  it "rejects stale and abandoned completions while preserving their reported cost" do
    capture
    interview.update!(revision: 1, status: "abandoned")
    result = Interviews::TranscriptionCaptureService.call(action: "finish", capture_id: capture.id, transcript: "Late answer",
      usage: { "audio_milliseconds" => 1000, "cost_microdollars" => 284 })
    expect(result).not_to be_success
    expect(capture.reload.transcript).to be_nil
    expect(capture.ai_task.reload.cost_microdollars).to eq(284)
  end

  it "rejects another active capture, stale input and a foreign question" do
    capture
    expect(Interviews::AuthorizeTranscriptionService.call(**input)).not_to be_success
    expect(Interviews::AuthorizeTranscriptionService.call(**input.merge(expected_revision: 1))).not_to be_success
    expect(Interviews::AuthorizeTranscriptionService.call(**input.merge(question_id: SecureRandom.uuid))).not_to be_success
  end

  it "releases expired capture slots and scrubs their text on session content cleanup" do
    capture.update!(expires_at: 1.second.ago)
    interview.update!(expires_at: 1.second.ago)
    expect(Interviews::CleanupService.call).to be_success
    expect(capture.reload.status).to eq("failed")
    expect(capture.ai_task.reload.status).to eq("failed")
    expect(capture.ai_task.ai_usage_attempts.find_by!(attempt_id: capture.observation_id)).to be_incomplete
  end
end

RSpec.describe "Live capture authorization fences" do
  let(:user) { create(:user) }
  let(:interview) { Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value }
  let(:input) { { interview: interview, question_id: interview.questions.first.id, expected_revision: 0 } }

  it "replaces an unredeemed capability without blocking a new answer" do
    first = Interviews::AuthorizeTranscriptionService.call(**input).value
    second = Interviews::AuthorizeTranscriptionService.call(**input).value
    expect(second[:capture_id]).not_to eq(first[:capture_id])
    expect(Interviews::TranscriptionCaptureService.call(action: "redeem", token: first[:token])).not_to be_success
    expect(Interviews::TranscriptionCaptureService.call(action: "redeem", token: second[:token])).to be_success
  end

  it "permits only one paid stream across the owner's interviews, even with earlier grants" do
    first = Interviews::AuthorizeTranscriptionService.call(**input).value
    other = Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value
    second = Interviews::AuthorizeTranscriptionService.call(interview: other, question_id: other.questions.first.id, expected_revision: 0).value
    expect(Interviews::TranscriptionCaptureService.call(action: "redeem", token: first[:token])).to be_success
    expect(Interviews::TranscriptionCaptureService.call(action: "redeem", token: second[:token])).not_to be_success
    expect(InterviewVerificationReservation.count).to eq(1)
  end

  it "caps cancelled attempts per question without charging unredeemed capabilities" do
    6.times { expect(Interviews::AuthorizeTranscriptionService.call(**input)).to be_success }
    expect(Interviews::AuthorizeTranscriptionService.call(**input)).not_to be_success
    expect(InterviewVerificationReservation.count).to eq(0)
  end

  it "scrubs capture text synchronously on abandonment while retaining its bill" do
    grant = Interviews::AuthorizeTranscriptionService.call(**input).value
    Interviews::TranscriptionCaptureService.call(action: "redeem", token: grant[:token])
    capture = InterviewTranscriptionCapture.find(grant[:capture_id])
    Interviews::TranscriptionCaptureService.call(action: "finish", capture_id: capture.id, transcript: "Private answer")
    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    expect(capture.reload.transcript).to be_nil
    expect(capture.ai_task.ai_usage_attempts.find_by!(attempt_id: capture.observation_id)).to be_incomplete
  end

  it "does not let already scrubbed rows starve later expired capture cleanup" do
    grant = Interviews::AuthorizeTranscriptionService.call(**input).value
    capture = InterviewTranscriptionCapture.find(grant[:capture_id])
    capture.update!(status: "failed", transcript: nil)
    interview.update!(expires_at: 1.second.ago)
    other = Interviews::CreateFixtureService.call(user: user, execution_mode: "real").value
    later = Interviews::AuthorizeTranscriptionService.call(interview: other, question_id: other.questions.first.id, expected_revision: 0).value
    later_capture = InterviewTranscriptionCapture.find(later[:capture_id])
    later_capture.update!(expires_at: 1.second.ago)
    Interviews::CleanupService.call(limit: 1)
    expect(later_capture.reload.status).to eq("failed")
  end
end

RSpec.describe "Capture and submitted answer admission" do
  it "rejects a late capability redemption once an answer is already processing" do
    interview = Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value
    question = interview.questions.first
    grant = Interviews::AuthorizeTranscriptionService.call(interview: interview, question_id: question.id, expected_revision: 0).value
    recording = ready_interview_recording(interview)
    expect(Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      recording_id: recording.id, expected_revision: 0, submission_key: "already-submitted")).to be_success
    result = Interviews::TranscriptionCaptureService.call(action: "redeem", token: grant[:token])
    expect(result).not_to be_success
    expect(InterviewVerificationReservation.count).to eq(0)
  end
end
