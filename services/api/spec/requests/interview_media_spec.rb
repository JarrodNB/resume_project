# Verifies machine media callbacks, persisted identity and storage outside DB locks.
require "rails_helper"

RSpec.describe "Internal interview media", type: :request do
  self.use_transactional_tests = false
  let(:user) { create(:user, email: "media-request-#{SecureRandom.uuid}@example.com") }
  let(:interview) { Interviews::CreateFixtureService.call(user: user).value }
  let(:operation) { interview.operations.speech.first }
  let(:headers) { { "Authorization" => "Bearer media-test" } }
  let(:path) { "/internal/interviews/operations/#{operation.id}" }
  let(:bytes) { "RIFF" + [ 40 ].pack("V") + "WAVEfmt " + [ 16, 1, 1, 8000, 16000, 2, 16 ].pack("VvvVVvv") + "data" + [ 4 ].pack("V") + "\0" * 4 }
  let(:storage) { instance_double(Interviews::MediaStorage) }

  around do |example|
    previous = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "media-test"
    example.run
  ensure
    ENV["INTERVIEW_SERVICE_SECRET"] = previous
    InterviewSessionMedia.where(interview_session_id: user.interview_sessions.select(:id)).delete_all if user.persisted?
    user.destroy! if user.persisted?
  end

  it "keeps storage I/O outside transactions while completing exactly the saved message" do
    original_lock_timeout = ApplicationRecord.connection.select_value("SHOW lock_timeout")
    allow(Interviews::MediaStorage).to receive(:new).and_return(storage)
    allow(storage).to receive(:upload_url) do |**|
      expect(ApplicationRecord.connection.transaction_open?).to be(false)
      "https://storage.test/scoped-write"
    end
    object = { bytes: bytes, checksum: Digest::MD5.base64digest(bytes), byte_size: bytes.bytesize, content_type: "audio/wav" }
    allow(storage).to receive(:read) do |_|
      expect(ApplicationRecord.connection.transaction_open?).to be(false)
      object
    end
    allow(storage).to receive(:write) do |**|
      expect(ApplicationRecord.connection.transaction_open?).to be(false)
    end
    post "#{path}/claim", headers: headers, as: :json
    identity = response.parsed_body.slice("attempt_id", "claim_generation")
    post "#{path}/reserve_audio", params: identity.merge(content_type: "audio/wav"), headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    media_id = response.parsed_body.fetch("media_id")
    post "#{path}/register_audio", params: identity.merge(media_id: media_id, checksum: object[:checksum], byte_size: bytes.bytesize), headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    post "#{path}/complete_audio", params: identity.merge(media_id: media_id), headers: headers, as: :json
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.fetch("message_id")).to eq(operation.message_id)
    expect(operation.reload).to be_accepted
    expect(interview.messages.count).to eq(1)
    expect(ApplicationRecord.connection.select_value("SHOW lock_timeout")).to eq(original_lock_timeout)
  end

  it "does not confer media authority without the separate service secret" do
    post "#{path}/reserve_audio", params: { content_type: "audio/wav", user_id: user.id }, as: :json
    expect(response).to have_http_status(:unauthorized)
    expect(InterviewSessionMedia.where(interview_session: interview)).not_to exist
  end

  it "rejects a media identity belonging to another operation" do
    other = Interviews::CreateFixtureService.call(user: user).value
    other_media = ready_interview_recording(other)
    post "#{path}/claim", headers: headers, as: :json
    identity = response.parsed_body.slice("attempt_id", "claim_generation")
    post "#{path}/complete_audio", params: identity.merge(media_id: other_media.id), headers: headers, as: :json
    expect(response).to have_http_status(:not_found)
    expect(operation.reload).to be_running
  end
end
