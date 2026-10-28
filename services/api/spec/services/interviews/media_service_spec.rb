# Exercises private upload identity, sealing and replay authorization through services.
require "rails_helper"

RSpec.describe "Interview private media" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:bytes) { "RIFF" + [ 40 ].pack("V") + "WAVEfmt " + [ 16, 1, 1, 8000, 16000, 2, 16 ].pack("VvvVVvv") + "data" + [ 4 ].pack("V") + "\0" * 4 }
  let(:storage) { InterviewMemoryStorage.new }
  def reserve(owner = interview)
    Interviews::ReserveRecordingService.call(interview: owner, question_id: owner.questions.first.id,
      expected_revision: owner.revision, content_type: "audio/wav", byte_size: bytes.bytesize,
      checksum: Digest::MD5.base64digest(bytes), storage: storage)
  end

  it "reserves an owned recording and seals validated staged bytes beyond upload authority" do
    result = reserve
    expect(result).to be_success
    media = InterviewSessionMedia.find(result.value[:media_id])
    expect(media).to have_attributes(kind: "recording", status: "reserved", interview_session_id: interview.id)
    storage.write(key: media.staging_key, bytes: bytes, content_type: "audio/wav", checksum: media.checksum)
    expect(Interviews::RegisterMediaService.call(media: media, storage: storage)).to be_success
    storage.write(key: media.staging_key, bytes: "replaced", content_type: "audio/wav", checksum: nil)
    expect(storage.read(media.reload.sealed_key)[:bytes]).to eq(bytes)
    expect(media).to be_ready
  end

  def registered_recording
    media = InterviewSessionMedia.find(reserve.value[:media_id])
    storage.write(key: media.staging_key, bytes: bytes, content_type: "audio/wav")
    expect(Interviews::RegisterMediaService.call(media: media, storage: storage)).to be_success
    media.reload
  end

  def speech_media
    operation = interview.operations.speech.first
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    identity = { attempt_id: operation.attempt_id, claim_generation: operation.claim_generation }
    reserved = Interviews::ReserveSpeechMediaService.call(operation: operation, **identity, content_type: "audio/wav", storage: storage)
    expect(reserved).to be_success
    media = InterviewSessionMedia.find(reserved.value[:media_id])
    storage.write(key: media.staging_key, bytes: bytes, content_type: "audio/wav")
    expect(Interviews::RegisterMediaService.call(media: media, **identity, checksum: Digest::MD5.base64digest(bytes),
      byte_size: bytes.bytesize, storage: storage)).to be_success
    [ media.reload, identity ]
  end

  it "invalidates accepted playback, new speech grants and stale completion after abandonment" do
    media, identity = speech_media
    operation = media.operation
    expect(Interviews::CompleteSpeechService.call(media: media, **identity)).to be_success
    expect(Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id, storage: storage)).to be_success
    expect(Interviews::AbandonService.call(interview: interview)).to be_success
    expect(Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id, storage: storage)).not_to be_success
    expect(Interviews::CompleteSpeechService.call(media: media, **identity)).not_to be_success
    expect(Interviews::RegisterMediaService.call(media: media, **identity, checksum: media.checksum,
      byte_size: media.byte_size, storage: storage)).not_to be_success
    expect(Interviews::ReserveSpeechMediaService.call(operation: operation, **identity, content_type: "audio/wav", storage: storage)).not_to be_success
    expect(Interviews::DeliveryStateService.call(operation: operation).value[:delivered]).to be(true)
    expect(reserve).not_to be_success
  end

  it "rejects a sealing write delayed across abandonment and reaps its late object" do
    media = InterviewSessionMedia.find(reserve.value[:media_id])
    storage.write(key: media.staging_key, bytes: bytes, content_type: "audio/wav")
    allow(storage).to receive(:write).and_wrap_original do |original, **arguments|
      if arguments[:key] == media.sealed_key
        expect(Interviews::AbandonService.call(interview: interview)).to be_success
        expect(Interviews::CleanupService.call(storage: storage).value[:deleted_media]).to eq(1)
      end
      original.call(**arguments)
    end
    expect(Interviews::RegisterMediaService.call(media: media, storage: storage)).not_to be_success
    expect(storage.objects).to have_key(media.sealed_key)
    expect(Interviews::CleanupService.call(storage: storage).value[:reaped_media]).to eq(1)
    expect(storage.objects).not_to have_key(media.sealed_key)
    expect(media.reload).to be_deleted
  end

  it "does not return an upload grant when abandonment commits during signing" do
    allow(storage).to receive(:upload_url).and_wrap_original do |original, **arguments|
      Interviews::AbandonService.call(interview: InterviewSession.find(interview.id))
      original.call(**arguments)
    end
    expect(reserve).not_to be_success
  end

  it "does not return playback when abandonment commits during signing" do
    media, identity = speech_media
    expect(Interviews::CompleteSpeechService.call(media: media, **identity)).to be_success
    allow(storage).to receive(:read_url).and_wrap_original do |original, **arguments|
      Interviews::AbandonService.call(interview: InterviewSession.find(interview.id))
      original.call(**arguments)
    end
    expect(Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id, storage: storage)).not_to be_success
  end

  it "rejects metadata forgery, oversized and foreign question reservations" do
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value
    result = Interviews::ReserveRecordingService.call(interview: interview, question_id: foreign.questions.first.id,
      expected_revision: 0, content_type: "audio/wav", byte_size: bytes.bytesize,
      checksum: Digest::MD5.base64digest(bytes), storage: storage)
    expect(result).not_to be_success
    media = InterviewSessionMedia.find(reserve.value[:media_id])
    storage.write(key: media.staging_key, bytes: "changed bytes", content_type: "audio/wav")
    expect(Interviews::RegisterMediaService.call(media: media, storage: storage)).not_to be_success
    expect(storage.objects).not_to have_key(media.sealed_key)
    expect(Interviews::ReserveRecordingService.call(interview: interview, question_id: interview.questions.first.id,
      expected_revision: 0, content_type: "audio/wav", byte_size: 10.megabytes + 1,
      checksum: Digest::MD5.base64digest(bytes), storage: storage)).not_to be_success
  end

  it "rejects forged content types even when object metadata and checksum agree" do
    fake = "this is not audio"
    result = Interviews::ReserveRecordingService.call(interview: interview, question_id: interview.questions.first.id,
      expected_revision: 0, content_type: "audio/wav", byte_size: fake.bytesize,
      checksum: Digest::MD5.base64digest(fake), storage: storage)
    media = InterviewSessionMedia.find(result.value[:media_id])
    storage.write(key: media.staging_key, bytes: fake, content_type: "audio/wav")
    expect(Interviews::RegisterMediaService.call(media: media, storage: storage)).not_to be_success
  end

  it "rejects registering a recording reservation after the interview revision advances" do
    media = InterviewSessionMedia.find(reserve.value[:media_id])
    storage.write(key: media.staging_key, bytes: bytes, content_type: "audio/wav")
    interview.update!(revision: 1)
    expect(Interviews::RegisterMediaService.call(media: media, storage: storage)).not_to be_success
    expect(media.reload).to be_reserved
  end

  it "attaches saved-message speech once and restricts playback to the owned interview and retention" do
    media, identity = speech_media
    2.times { expect(Interviews::CompleteSpeechService.call(media: media, **identity)).to be_success }
    expect(media.operation.reload).to be_accepted
    expect(media.operation.ai_task.ai_task_outcomes.pluck(:status)).to eq([ "completed" ])
    expect(interview.messages.count).to eq(1)
    replay = Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id, storage: storage)
    expect(replay).to be_success
    expect(replay.value[:expires_in]).to be <= 60
    other = Interviews::CreateFixtureService.call(user: create(:user)).value
    expect(Interviews::ReadMediaService.call(interview: other, message_id: media.message_id, storage: storage)).not_to be_success
    interview.update!(status: "completed", completed_at: 1.hour.ago)
    expect(Interviews::ReadMediaService.call(interview: interview, message_id: media.message_id, storage: storage)).not_to be_success
    expect(Interviews::CompleteSpeechService.call(media: media.reload, **identity)).not_to be_success
  end

  it "rejects stale speech upload registration and attachment after replacement claim" do
    media, identity = speech_media
    operation = media.operation
    operation.update!(attempt_id: SecureRandom.uuid, claim_generation: operation.claim_generation + 1)
    expect(Interviews::CompleteSpeechService.call(media: media, **identity)).not_to be_success
    expect(Interviews::RegisterMediaService.call(media: media, **identity, checksum: media.checksum,
      byte_size: media.byte_size, storage: storage)).not_to be_success
    expect(operation.reload).to be_running
  end

  it "plays only the accepted artifact after an older ready speech reservation loses its claim" do
    stale, old_identity = speech_media
    operation = stale.operation
    operation.update!(attempt_id: SecureRandom.uuid, claim_generation: operation.claim_generation + 1)
    identity = { attempt_id: operation.attempt_id, claim_generation: operation.claim_generation }
    # Claim rows/usage are created by the actual claimant; the media reservation only
    # needs its persisted current identity and saved-message binding.
    result = Interviews::ReserveSpeechMediaService.call(operation: operation, **identity, content_type: "audio/wav", storage: storage)
    fresh = InterviewSessionMedia.find(result.value[:media_id])
    storage.write(key: fresh.staging_key, bytes: bytes, content_type: "audio/wav")
    Interviews::RegisterMediaService.call(media: fresh, **identity, checksum: Digest::MD5.base64digest(bytes), byte_size: bytes.bytesize, storage: storage)
    expect(Interviews::CompleteSpeechService.call(media: fresh, **identity)).to be_success
    expect(Interviews::CompleteSpeechService.call(media: stale, **old_identity)).not_to be_success
    replay = Interviews::ReadMediaService.call(interview: interview, message_id: fresh.message_id, storage: storage)
    expect(replay).to be_success
    expect(replay.value[:playback_url]).to include(fresh.sealed_key)
    travel 1.hour + 1.second
    Interviews::CleanupService.call(storage: storage)
    expect(stale.reload).to be_deleted
    expect(fresh.reload).to be_ready
    expect(storage.objects).to have_key(fresh.sealed_key)
  end

  it "expires source recordings on permanent failure and rejects retries with deleted audio" do
    media = registered_recording
    operation = Interviews::SubmitTurnService.call(interview: interview, question_id: media.question_id,
      recording_id: media.id, expected_revision: 0, submission_key: "invalid-source").value
    Interviews::ClaimOperationService.call(operation: operation)
    expect(Interviews::FailOperationService.call(operation: operation, attempt_id: operation.attempt_id,
      claim_generation: operation.claim_generation, code: "invalid_recording", retryable: false)).to be_success
    expect(media.reload.expires_at).to be <= Time.current
    Interviews::CleanupService.call(storage: storage)
    expect(media.reload).to be_deleted
    expect(Interviews::RetryOperationService.call(operation: operation)).not_to be_success
  end

  it "reads only the current turn's sealed recording through a lease-bounded capability" do
    media = registered_recording
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: media.question_id,
      recording_id: media.id, expected_revision: 0, submission_key: "upload-turn").value
    expect(Interviews::ClaimOperationService.call(operation: turn)).to be_success
    identity = { operation: turn, attempt_id: turn.attempt_id, claim_generation: turn.claim_generation }
    result = Interviews::ReadRecordingService.call(**identity, storage: storage)
    expect(result).to be_success
    expect(result.value[:download_url]).to include(media.sealed_key)
    expect(result.value[:download_url]).not_to include(media.staging_key)
    expect(result.value[:expires_in]).to be <= 30
    travel 31.seconds
    expect(Interviews::ReadRecordingService.call(**identity, storage: storage)).not_to be_success
  end

  it "expires accepted source audio immediately and makes terminal failures collectible" do
    media = registered_recording
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: media.question_id,
      recording_id: media.id, expected_revision: 0, submission_key: "accepted-audio").value
    Interviews::ClaimOperationService.call(operation: turn)
    identity = { operation: turn, attempt_id: turn.attempt_id, claim_generation: turn.claim_generation }
    expect(Interviews::AcceptTurnService.call(**identity, transcript: "A synthetic answer", decision: "advance",
      history_version: 1, model_history: [])).to be_success
    expect(media.reload.expires_at).to be <= Time.current
    expect(Interviews::CleanupService.call(storage: storage)).to be_success
    expect(storage.objects).not_to have_key(media.sealed_key)
  end

  it "rejects a turn result after its recording expires even while the execution lease is valid" do
    media = registered_recording
    media.update!(expires_at: 10.seconds.from_now)
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: media.question_id,
      recording_id: media.id, expected_revision: 0, submission_key: "expires-mid-execution").value
    Interviews::ClaimOperationService.call(operation: turn)
    travel 11.seconds
    result = Interviews::AcceptTurnService.call(operation: turn, attempt_id: turn.attempt_id,
      claim_generation: turn.claim_generation, transcript: "A synthetic answer", decision: "advance",
      history_version: 1, model_history: [])
    expect(result).not_to be_success
    expect(interview.reload.revision).to eq(0)
    expect(interview.messages.count).to eq(1)
  end

  it "reaps late sealed writes after cleanup races registration without losing a durable key" do
    media = InterviewSessionMedia.find(reserve.value[:media_id])
    storage.write(key: media.staging_key, bytes: bytes, content_type: "audio/wav")
    original_write = storage.method(:write)
    allow(storage).to receive(:write) do |**arguments|
      media.update!(expires_at: 1.second.ago)
      Interviews::CleanupService.call(storage: storage)
      original_write.call(**arguments)
    end
    result = Interviews::RegisterMediaService.call(media: media, storage: storage)
    expect(result).not_to be_success
    expect(media.reload).to be_deleted
    expect(media.sealed_key).to be_present
    expect(storage.objects).to have_key(media.sealed_key)
    Interviews::CleanupService.call(storage: storage)
    expect(storage.objects).not_to have_key(media.sealed_key)
    # A still-valid staging grant can also finish late, so periodic tombstone reaping
    # covers interrupted registrations and abandoned direct uploads alike.
    original_write.call(key: media.staging_key, bytes: bytes, content_type: "audio/wav")
    travel 1.hour + 1.second
    Interviews::CleanupService.call(storage: storage)
    expect(storage.objects).not_to have_key(media.staging_key)
  end
end

# Models S3's still-writable staging object; sealed keys are never issued for PUT.
class InterviewMemoryStorage
  attr_reader :objects
  def initialize
    @objects = {}
  end
  def upload_url(key:, **)
    "https://storage.test/#{key}?write=temporary"
  end
  def read_url(key:, **)
    "https://storage.test/#{key}?read=temporary"
  end
  def write(key:, bytes:, content_type:, **)
    @objects[key] = { bytes: bytes, content_type: content_type, checksum: Digest::MD5.base64digest(bytes), byte_size: bytes.bytesize }
  end
  def read(key)
    @objects.fetch(key)
  end
  def delete(key)
    @objects.delete(key)
  end
end
