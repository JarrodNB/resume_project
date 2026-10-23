# Exercises document checks through the start and worker services without exposing uploads.
require "rails_helper"

RSpec.describe "DOCX check lifecycle" do
  let(:user) { create(:user) }
  let(:bytes) { "synthetic DOCX bytes".b }
  let(:digest) { Digest::SHA256.hexdigest(bytes) }
  let(:storage) { double("private storage", write: true, delete: true) }
  let(:file) { StringIO.new(bytes) }

  before do
    validator = Class.new do
      def self.call(path:) = ServiceResult.new(success: true, value: true, errors: [])
    end
    stub_const("DocumentPageChecks::DocxPackageValidator", validator)
  end

  it "persists a queued digest-bound check and emits asynchronous work" do
    result = nil
    expect {
      result = DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: digest, storage: storage)
    }.to have_enqueued_job(DocumentPageChecks::CountPagesJob)
    expect(result).to be_success
    expect(result.value.reload).to have_attributes(user_id: user.id, content_digest: digest, status: "queued")
  end
  def start_check(**options)
    DocumentPageChecks::StartCheckService.call(user: user, file: StringIO.new(bytes), content_digest: digest, storage: storage, **options).value
  end

  it "reuses a digest without uploading or emitting duplicate work" do
    check = start_check
    expect(storage).not_to receive(:write)
    expect { expect(start_check.id).to eq(check.id) }.not_to have_enqueued_job
  end

  it "rejects changed bytes and oversized input before storage" do
    expect(storage).not_to receive(:write)
    result = DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: "0" * 64, storage: storage)
    expect(result.errors).to include("Document digest does not match")
    result = DocumentPageChecks::StartCheckService.call(user: user, file: StringIO.new("x" * (5.megabytes + 1)), content_digest: digest, storage: storage)
    expect(result).not_to be_success
  end

  it "limits concurrent checks for one owner independently of AI usage" do
    2.times do |i|
      user.resume_docx_page_checks.create!(content_digest: i.to_s * 64, expires_at: 1.hour.from_now)
    end
    expect(DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: digest, storage: storage)).not_to be_success
  end

  it "counts once, removes bytes and preserves the terminal result on duplicate delivery" do
    check = start_check
    allow(storage).to receive(:read).and_return(bytes)
    counter = double("counter", call: ServiceResult.new(success: true, value: 3, errors: []))
    result = DocumentPageChecks::CountPagesService.call(check: check, storage: storage, counter: counter)
    expect(result).to be_success
    expect(check.reload).to have_attributes(status: "completed", page_count: 3, storage_key: nil)
    expect(counter).to receive(:call).never
    DocumentPageChecks::CountPagesService.call(check: check, storage: storage, counter: counter)
  end

  it "rejects stored bytes whose digest no longer matches" do
    check = start_check
    allow(storage).to receive(:read).and_return("changed")
    counter = double("counter")
    expect(counter).not_to receive(:call)
    DocumentPageChecks::CountPagesService.call(check: check, storage: storage, counter: counter)
    expect(check.reload).to have_attributes(status: "failed", error_code: "unavailable", storage_key: nil)
  end

  it "retains a cleanup obligation when private deletion fails and retries it later" do
    check = start_check
    key = check.storage_key
    check.update!(status: "failed")
    allow(storage).to receive(:delete).and_raise(IOError)
    expect(DocumentPageChecks::PurgeUploadService.call(check: check, storage: storage)).not_to be_success
    expect(check.reload.storage_key).to eq(key)
    allow(storage).to receive(:delete).and_return(true)
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(check.reload.storage_key).to be_nil
  end

  it "does not let a stale execution replace a newer result or delete a newer upload" do
    check = start_check
    old_key = check.storage_key
    allow(storage).to receive(:read).and_return(bytes)
    counter = double("counter")
    allow(counter).to receive(:call) do
      check.update!(attempt_token: SecureRandom.uuid, status: "completed", page_count: 7, storage_key: "new-private-key")
      ServiceResult.new(success: true, value: 3, errors: [])
    end
    DocumentPageChecks::CountPagesService.call(check: check, storage: storage, counter: counter)
    expect(check.reload).to have_attributes(page_count: 7, storage_key: "new-private-key")
    expect(storage).to have_received(:delete).with(old_key)
    expect(storage).not_to have_received(:delete).with("new-private-key")
  end

  it "expires abandoned execution and reaps metadata within 24 hours" do
    check = start_check
    check.update!(status: "running", attempt_token: SecureRandom.uuid, lease_expires_at: 1.second.ago)
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(check.reload).to have_attributes(status: "failed", error_code: "expired", storage_key: nil)
    travel 24.hours do
      DocumentPageChecks::CleanupChecksService.call(storage: storage)
      expect(ResumeDocxPageCheck.exists?(check.id)).to be(false)
    end
  end

  it "keeps private cleanup keys after account deletion" do
    check = start_check
    user.destroy!
    expect(check.reload.user_id).to be_nil
    expect(check.storage_key).to be_present
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(ResumeDocxPageCheck.exists?(check.id)).to be(false)
  end

  it "supports an explicit failed retry without permanently caching converter errors" do
    check = start_check
    check.update!(status: "failed", storage_key: nil)
    expect(start_check(retry_failed: true)).to have_attributes(id: check.id, status: "queued", retry_count: 1)
  end

  it "retains failed-upload cleanup even when storage deletion also fails" do
    allow(storage).to receive(:write).and_raise(IOError)
    allow(storage).to receive(:delete).and_raise(IOError)
    result = DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: digest, storage: storage)
    expect(result).not_to be_success
    check = user.resume_docx_page_checks.sole
    expect(check).to have_attributes(status: "failed", error_code: "unavailable")
    expect(check.storage_key).to be_present
  end

  it "does not expire a fresh retry because the original request was old" do
    check = start_check
    check.update!(status: "failed", storage_key: nil, created_at: 1.hour.ago)
    check = start_check(retry_failed: true)
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(check.reload.status).to eq("queued")
  end

  it "rotates failed storage cleanup instead of starving later private objects" do
    101.times do |i|
      ResumeDocxPageCheck.create!(user: user, content_digest: i.to_s.rjust(64, "0"),
        status: "failed", storage_key: "private/#{i}", expires_at: 1.hour.ago)
    end
    attempted = []
    allow(storage).to receive(:delete) { |key| attempted << key; raise IOError }
    2.times { DocumentPageChecks::CleanupChecksService.call(storage: storage) }
    expect(attempted.uniq.length).to eq(101)
  end
  it "reaps a late upload after account deletion runs cleanup during the write" do
    objects = {}
    allow(storage).to receive(:delete) { |key| objects.delete(key) }
    allow(storage).to receive(:write) do |key:, bytes:|
      user.destroy!
      DocumentPageChecks::CleanupChecksService.call(storage: storage)
      objects[key] = bytes
    end
    result = DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: digest, storage: storage)
    expect(result).not_to be_success
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(objects).to be_empty
  end

  it "retains a late-upload cleanup obligation when the writer's final deletion fails" do
    objects = {}
    writes_finished = false
    allow(storage).to receive(:delete) do |key|
      raise IOError if writes_finished
      objects.delete(key)
    end
    allow(storage).to receive(:write) do |key:, bytes:|
      user.destroy!
      DocumentPageChecks::CleanupChecksService.call(storage: storage)
      objects[key] = bytes
      writes_finished = true
    end
    result = DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: digest, storage: storage)
    expect(result).not_to be_success
    check = ResumeDocxPageCheck.sole
    expect(objects.keys).to eq([ check.storage_key ])
    allow(storage).to receive(:delete) { |key| objects.delete(key) }
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(objects).to be_empty
    expect(ResumeDocxPageCheck.exists?(check.id)).to be(false)
  end

  it "retains interrupted-upload tombstones through the delayed-write interval" do
    check = user.resume_docx_page_checks.create!(content_digest: digest, storage_key: "interrupted-upload",
      expires_at: 1.hour.from_now, upload_expires_at: 30.seconds.from_now)
    user.destroy!
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(check.reload.storage_key).to eq("interrupted-upload")
    travel 31.seconds do
      DocumentPageChecks::CleanupChecksService.call(storage: storage)
      expect(check.reload).to have_attributes(status: "failed", storage_key: "interrupted-upload")
    end
    travel 6.minutes do
      DocumentPageChecks::CleanupChecksService.call(storage: storage)
      expect(ResumeDocxPageCheck.exists?(check.id)).to be(false)
    end
  end

  it "expires stale pending uploads without requiring account deletion" do
    check = user.resume_docx_page_checks.create!(content_digest: digest, storage_key: "aborted-upload",
      expires_at: 1.hour.from_now, upload_expires_at: 1.second.ago)
    DocumentPageChecks::CleanupChecksService.call(storage: storage)
    expect(check.reload).to have_attributes(status: "failed", storage_key: "aborted-upload")
    travel 6.minutes do
      DocumentPageChecks::CleanupChecksService.call(storage: storage)
      expect(check.reload.storage_key).to be_nil
    end
  end

  it "does not start a PUT after its upload reservation expires" do
    allow(user).to receive(:with_lock).and_wrap_original do |original, &block|
      original.call(&block)
      travel_to 31.seconds.from_now
    end
    expect(storage).not_to receive(:write)
    result = DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: digest, storage: storage)
    expect(result).not_to be_success
    expect(user.resume_docx_page_checks.sole.storage_key).to be_present
  ensure
    travel_back
  end

  it "deletes the captured upload even if its metadata is unexpectedly absent" do
    check = start_check
    key = check.storage_key
    check.destroy!
    expect(DocumentPageChecks::PurgeUploadService.call(check: check, storage: storage, key: key)).to be_success
    expect(storage).to have_received(:delete).with(key)
  end

  it "bounds a hung writer and prevents retry from replacing its pending cleanup key" do
    stub_const("DocumentPageChecks::StartCheckService::UPLOAD_TIMEOUT", 0.02.seconds)
    allow(storage).to receive(:write) { sleep 1 }
    result = DocumentPageChecks::StartCheckService.call(user: user, file: file, content_digest: digest, storage: storage)
    expect(result).not_to be_success
    check = user.resume_docx_page_checks.sole
    key = check.storage_key
    expect(check).to have_attributes(status: "failed", upload_ready: false)
    expect(key).to be_present
    result = DocumentPageChecks::StartCheckService.call(user: user, file: StringIO.new(bytes),
      content_digest: digest, storage: storage, retry_failed: true)
    expect(result).not_to be_success
    expect(check.reload.storage_key).to eq(key)
    travel 6.minutes do
      DocumentPageChecks::CleanupChecksService.call(storage: storage)
      expect(check.reload.storage_key).to be_nil
      allow(storage).to receive(:write).and_return(true)
      retried = start_check(retry_failed: true)
      expect(retried.storage_key).not_to eq(key)
      expect(retried).to have_attributes(status: "queued", upload_ready: true)
      DocumentPageChecks::PurgeUploadService.call(check: check, key: key, storage: storage)
      expect(retried.reload.storage_key).to be_present
    end
  end
end
