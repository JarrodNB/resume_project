# Authenticate exact-export submissions through the public GraphQL boundary.
require "rails_helper"
RSpec.describe "submitResumeAtsPdf" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:resume) { user.resumes.create!(job: job, title: "Developer") }
  let!(:section) { resume.sections.create!(section_type: "summary", title: "Summary", position: 0, content: { text: "Ruby developer" }) }
  let(:run) { AtsChecks::ScheduleContentCheckService.call(resume: resume).value }
  let(:query) { <<~GRAPHQL }
    mutation Check($resume: ID!, $run: ID!, $fingerprint: String!, $file: Upload!) {
      submitResumeAtsPdf(input: {resumeId: $resume, runId: $run, contentFingerprint: $fingerprint, rendererVersion: "resume-pdf-v1", file: $file}) {
        errors report { runId pdfReadability { status } }
      }
    }
  GRAPHQL
  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
    allow(ApiSchema.subscriptions).to receive(:trigger)
  end
  def execute_as(owner)
    upload = ApolloUploadServer::Wrappers::UploadedFile.new(build_uploaded_file(content: minimal_pdf_bytes, filename: "resume.pdf"))
    execute_graphql(query, user: owner, variables: { resume: resume.id, run: run.id, fingerprint: run.content_fingerprint, file: upload })
  end
  it "accepts the owned saved version" do
    result = execute_as(user)
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "submitResumeAtsPdf", "errors")).to eq([])
    expect(result.dig("data", "submitResumeAtsPdf", "report", "pdfReadability", "status")).to eq("queued")
  end
  it "rejects another users resume before storing bytes" do
    result = execute_as(create(:user))
    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(ActiveStorage::Blob.count).to eq(0)
  end
end
