# Confirms document checks keep authentication and resume ownership at the GraphQL boundary.
require "rails_helper"
RSpec.describe "Resume DOCX page checks" do
  let(:user) { create(:user) }
  let(:mutation) { <<~GRAPHQL }
    mutation($file: Upload!, $digest: String!, $resumeId: ID) {
      startResumeDocxPageCheck(input: {file: $file, contentDigest: $digest, resumeId: $resumeId}) {
        check { id status contentDigest pageCount errorCode expiresAt }
        errors
      }
    }
  GRAPHQL
  let(:file) { ApolloUploadServer::Wrappers::UploadedFile.new(build_uploaded_file(content: "bytes", filename: "resume.docx")) }

  it "starts a draft export check without requiring a saved resume" do
    check = ResumeDocxPageCheck.create!(user: user, content_digest: "a" * 64, expires_at: 23.hours.from_now)
    allow(DocumentPageChecks::StartCheckService).to receive(:call).and_return(ServiceResult.new(success: true, value: check, errors: []))
    result = execute_graphql(mutation, user: user, variables: { file: file, digest: "a" * 64 })
    expect(result.dig("data", "startResumeDocxPageCheck", "check", "id")).to eq(check.id)
    expect(DocumentPageChecks::StartCheckService).to have_received(:call).with(user: user, file: file, content_digest: "a" * 64, resume: nil, retry_failed: false)
  end

  it "does not pass someone else's resume to the service" do
    resume = create(:resume)
    expect(DocumentPageChecks::StartCheckService).not_to receive(:call)
    result = execute_graphql(mutation, user: user, variables: { file: file, digest: "a" * 64, resumeId: resume.id })
    expect(result.fetch("errors").first.fetch("message")).to eq("Record not found")
  end

  it "returns only owned pagination metadata" do
    check = ResumeDocxPageCheck.create!(user: user, content_digest: "a" * 64, expires_at: 23.hours.from_now)
    query = "query($id: ID!) { resumeDocxPageCheck(id: $id) { id status contentDigest } }"
    expect(execute_graphql(query, user: user, variables: { id: check.id }).dig("data", "resumeDocxPageCheck", "id")).to eq(check.id)
    result = execute_graphql(query, user: create(:user), variables: { id: check.id })
    expect(result.fetch("errors").first.fetch("message")).to eq("Record not found")
  end
end
