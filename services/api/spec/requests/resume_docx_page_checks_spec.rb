# Exercises the real authenticated multipart boundary without a storage provider.
require "rails_helper"
RSpec.describe "DOCX multipart checks", type: :request do
  let(:query) { 'mutation($file: Upload!, $digest: String!) { startResumeDocxPageCheck(input: {file: $file, contentDigest: $digest}) { errors check { id status } } }' }
  let(:bytes) { "invalid DOCX bytes" }

  def upload
    post "/graphql", params: {
      operations: { query: query, variables: { file: nil, digest: Digest::SHA256.hexdigest(bytes) } }.to_json,
      map: { "0" => [ "variables.file" ] }.to_json,
      "0" => Rack::Test::UploadedFile.new(StringIO.new(bytes), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", original_filename: "resume.docx")
    }
  end

  it "rejects an unauthenticated multipart start" do
    upload
    expect(response).to have_http_status(:unauthorized)
    expect(ResumeDocxPageCheck.count).to eq(0)
  end

  it "handles an authenticated malformed package as a nonblocking validation error" do
    user = create(:user)
    post "/auth/sign_in", params: { user: { email: user.email, password: "a quiet orchard after rain" } }, as: :json
    expect(response).to have_http_status(:ok)
    upload
    expect(response).to have_http_status(:ok)
    expect(response.parsed_body.dig("data", "startResumeDocxPageCheck", "errors")).to include("Invalid DOCX package")
    expect(ResumeDocxPageCheck.count).to eq(0)
  end
end
