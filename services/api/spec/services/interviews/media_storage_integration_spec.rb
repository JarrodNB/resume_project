# Opt-in checks against the isolated local S3Mock stack. No provider calls are made.
# Run once normally, recreate S3, then run with INTERVIEW_STORAGE_RECREATED=1.
require "rails_helper"
require "net/http"

RSpec.describe "Interview object storage integration" do
  before { skip "Set INTERVIEW_STORAGE_INTEGRATION=1 for local S3Mock" unless ENV["INTERVIEW_STORAGE_INTEGRATION"] == "1" }
  let(:storage) { Interviews::MediaStorage.new }
  let(:bytes) { "RIFF" + [ 40 ].pack("V") + "WAVEfmt " + [ 16, 1, 1, 8000, 16000, 2, 16 ].pack("VvvVVvv") + "data" + [ 4 ].pack("V") + "\0" * 4 }
  let(:probe_key) { "interviews/storage-recreation-probe" }

  def put(url, payload, headers)
    uri = URI(url)
    Net::HTTP.start(uri.host, uri.port, open_timeout: 3, read_timeout: 5) do |http|
      http.request(Net::HTTP::Put.new(uri, headers).tap { |request| request.body = payload })
    end
  end

  it "seals actual direct-upload bytes, so a surviving PUT grant cannot replace playback" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    result = Interviews::ReserveRecordingService.call(interview: interview, question_id: interview.questions.first.id,
      expected_revision: 0, content_type: "audio/wav", byte_size: bytes.bytesize,
      checksum: Digest::MD5.base64digest(bytes), storage: storage)
    expect(result).to be_success
    expect(put(result.value[:upload_url], bytes, result.value[:headers]).code).to eq("200")
    media = InterviewSessionMedia.find(result.value[:media_id])
    expect(Interviews::RegisterMediaService.call(media: media, storage: storage)).to be_success
    # S3 may reject different bytes under the MD5-bound grant. Writing the same bytes
    # still proves that the staging grant remains usable after sealing.
    expect(put(result.value[:upload_url], bytes, result.value[:headers]).code).to eq("200")
    storage.write(key: media.staging_key, bytes: "replacement", content_type: "audio/wav", checksum: Digest::MD5.base64digest("replacement"))
    expect(storage.read(media.sealed_key)[:bytes]).to eq(bytes)
    [ media.staging_key, media.sealed_key ].each { |key| storage.delete(key) }
  end

  it "persists the exact object across S3 container recreation" do
    if ENV["INTERVIEW_STORAGE_RECREATED"] == "1"
      expect(storage.read(probe_key)[:bytes]).to eq(bytes)
      storage.delete(probe_key)
    else
      storage.write(key: probe_key, bytes: bytes, content_type: "audio/wav", checksum: Digest::MD5.base64digest(bytes))
      expect(storage.read(probe_key)[:bytes]).to eq(bytes)
    end
  end
end
