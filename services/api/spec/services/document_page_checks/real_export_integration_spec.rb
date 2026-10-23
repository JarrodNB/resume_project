# Opt-in full private-storage and LibreOffice test using synthetic browser-generated DOCX files.
# Run with DOCX_EXPORT_FIXTURES=/fixtures and S3_ENDPOINT_URL pointing at isolated S3Mock.
require "rails_helper"
RSpec.describe "Real DOCX export page checks" do
  before { skip "Set DOCX_REAL_STORAGE_TEST=true to run real storage/rendering" unless ENV["DOCX_REAL_STORAGE_TEST"] == "true" || ENV["DOCX_EXPORT_FIXTURES"] }

  it "checks exact generated short and overflowing bytes and purges both private objects" do
    user = create(:user)
    storage = DocumentPageChecks::PrivateStorage.new
    { "short" => 1, "overflow" => 4 }.each do |name, expected|
      bytes = File.binread(File.join(ENV.fetch("DOCX_EXPORT_FIXTURES", Rails.root.join("spec/fixtures/resume_exports").to_s), "#{name}.docx"))
      result = DocumentPageChecks::StartCheckService.call(user: user, file: StringIO.new(bytes),
        content_digest: Digest::SHA256.hexdigest(bytes), storage: storage)
      expect(result).to be_success
      check = result.value
      key = check.storage_key
      expect(storage.read(key)).to eq(bytes)
      DocumentPageChecks::CountPagesJob.perform_now(check.id)
      expect(check.reload).to have_attributes(status: "completed", page_count: expected, storage_key: nil)
      expect { storage.read(key) }.to raise_error(Aws::S3::Errors::NoSuchKey)
    end
  end
end
