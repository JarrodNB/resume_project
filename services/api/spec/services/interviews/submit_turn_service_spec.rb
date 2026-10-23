# Checks immutable submission identity and the single active answer slot through the service.
require "rails_helper"

RSpec.describe "Basic Interview submission" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:input) do
    { interview: interview, question_id: interview.questions.first.id, recording_id: ready_interview_recording(interview).id,
      expected_revision: 0, submission_key: "browser-request-1" }
  end

  it "rejects absent, foreign, unsealed, expired and reused recordings" do
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value
    foreign_recording = ready_interview_recording(foreign)
    own = ready_interview_recording(interview)
    [ SecureRandom.uuid, foreign_recording.id ].each do |id|
      expect(Interviews::SubmitTurnService.call(**input.merge(recording_id: id))).not_to be_success
    end
    own.update!(status: "reserved")
    expect(Interviews::SubmitTurnService.call(**input.merge(recording_id: own.id))).not_to be_success
    own.update!(status: "ready", expires_at: 1.second.ago)
    expect(Interviews::SubmitTurnService.call(**input.merge(recording_id: own.id))).not_to be_success
    own.update!(expires_at: 1.hour.from_now)
    original = Interviews::SubmitTurnService.call(**input.merge(recording_id: own.id)).value
    original.update!(status: "failed")
    expect(Interviews::SubmitTurnService.call(**input.merge(recording_id: own.id, submission_key: "reuse"))).not_to be_success
  end

  it "persists a turn once and resolves the same fingerprint even after revision changes" do
    first = Interviews::SubmitTurnService.call(**input)
    expect(first).to be_success
    interview.update!(revision: 1)
    repeated = Interviews::SubmitTurnService.call(**input)
    expect(repeated).to be_success
    expect(repeated.value.id).to eq(first.value.id)
    expect(interview.operations.turn.count).to eq(1)
  end
  it "rejects changed recording, question, or revision under the same submission key" do
    expect(Interviews::SubmitTurnService.call(**input)).to be_success
    [ { recording_id: SecureRandom.uuid }, { question_id: SecureRandom.uuid }, { expected_revision: 1 } ].each do |change|
      result = Interviews::SubmitTurnService.call(**input.merge(change))
      expect(result).not_to be_success
      expect(result.errors).to include("Submission key conflicts with its original inputs")
    end
    expect(interview.operations.turn.count).to eq(1)
  end

  it "refuses another active turn and permits a new recording after a failed turn" do
    first = Interviews::SubmitTurnService.call(**input).value
    another = input.merge(submission_key: "other-key", recording_id: ready_interview_recording(interview).id)
    expect(Interviews::SubmitTurnService.call(**another)).not_to be_success
    first.update!(status: "failed")
    expect(Interviews::SubmitTurnService.call(**another)).to be_success
    expect(interview.questions.first.accepted_answer_count).to eq(0)
  end

  it "rejects stale revisions, non-current or foreign questions, and inactive or expired sessions" do
    expect(Interviews::SubmitTurnService.call(**input.merge(expected_revision: 1))).not_to be_success
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value.questions.first
    expect(Interviews::SubmitTurnService.call(**input.merge(question_id: foreign.id))).not_to be_success
    interview.update!(expires_at: 1.second.ago)
    expect(Interviews::SubmitTurnService.call(**input)).not_to be_success
    interview.update!(expires_at: 1.day.from_now, status: "completed")
    expect(Interviews::SubmitTurnService.call(**input)).not_to be_success
    expect(interview.operations.turn.count).to eq(0)
  end

  it "reports malformed identities without a database exception" do
    [ { submission_key: " " }, { submission_key: "x" * 201 }, { recording_id: "not-a-uuid" },
      { expected_revision: "0" }, { question_id: nil } ].each do |change|
      expect(Interviews::SubmitTurnService.call(**input.merge(change))).not_to be_success
    end
  end
end

RSpec.describe "Recognized interview answers" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:input) do
    { interview: interview, question_id: interview.questions.first.id, recording_id: ready_interview_recording(interview).id,
      expected_revision: 0, submission_key: "recognized-answer", transcription_mode: "browser", candidate_transcript: "I reduced response time." }
  end
  it "saves final text once, exposes it only to owned execution, and rejects changed replay" do
    result = Interviews::SubmitTurnService.call(**input)
    expect(result).to be_success
    expect(result.value.candidate_transcript).to eq("I reduced response time.")
    expect(Interviews::SubmitTurnService.call(**input.merge(candidate_transcript: "Changed answer"))).not_to be_success
    claim = Interviews::ClaimOperationService.call(operation: result.value)
    expect(claim.value.fetch(:payload).fetch(:candidate_transcript)).to eq("I reduced response time.")
    expect(claim.value.fetch(:payload).fetch(:transcription_mode)).to eq("browser")
  end
end

RSpec.describe "Recognized answer recovery and retention" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:input) do
    { interview: interview, question_id: interview.questions.first.id, recording_id: ready_interview_recording(interview).id,
      expected_revision: 0, submission_key: "recognized-recovery", transcription_mode: "browser", candidate_transcript: "I reduced response time." }
  end
  it "allows a digest-only replay of an existing answer but never creates a textless recognized answer" do
    original = Interviews::SubmitTurnService.call(**input).value
    recovery = input.except(:candidate_transcript).merge(transcript_digest: Digest::SHA256.hexdigest(input[:candidate_transcript]))
    expect(Interviews::SubmitTurnService.call(**recovery).value.id).to eq(original.id)
    expect(Interviews::SubmitTurnService.call(**recovery.merge(submission_key: "new-key"))).not_to be_success
    expect(interview.operations.turn.count).to eq(1)
  end
  it "rejects invalid or oversized text and mode mismatches without consuming a slot" do
    [ { candidate_transcript: " " }, { candidate_transcript: "x" * 4001 }, { transcription_mode: "recorded" }, { transcription_mode: "unknown" }, { transcript_digest: "0" * 64 } ].each do |change|
      expect(Interviews::SubmitTurnService.call(**input.merge(change))).not_to be_success
    end
    expect(interview.operations.turn).to be_empty
  end
  it "scrubs unscreened candidate text on abandonment and content expiry while keeping fingerprints" do
    operation = Interviews::SubmitTurnService.call(**input).value
    fingerprint = operation.request_fingerprint
    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    expect(operation.reload.candidate_transcript).to be_nil
    expect(operation.request_fingerprint).to eq(fingerprint)
    operation.update!(candidate_transcript: "Retained input")
    interview.update!(expires_at: 1.second.ago)
    storage = instance_double(Interviews::MediaStorage, delete: nil)
    expect(Interviews::CleanupService.call(storage: storage)).to be_success
    expect(operation.reload.candidate_transcript).to be_nil
  end
end
