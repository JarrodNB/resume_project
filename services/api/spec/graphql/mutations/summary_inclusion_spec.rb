# Summary preferences change only the signed-in user's defaults and owned resumes.
require "rails_helper"

RSpec.describe "Summary inclusion preferences" do
  let(:user) { create(:user, summary: "Saved career facts.") }

  it "updates the library default, preserving summary text and existing resumes" do
    resume = create(:resume, user: user)
    other = create(:user)
    result = execute_graphql(<<~GQL, user: user)
      mutation { updateProfile(input: { attributes: { includeSummary: false } }) {
        user { includeSummary summary } errors
      } }
    GQL
    expect(result.dig("data", "updateProfile")).to eq("user" => { "includeSummary" => false, "summary" => "Saved career facts." }, "errors" => [])
    expect(user.reload.include_summary).to be(false)
    expect(resume.reload.include_summary).to be(true)
    expect(other.reload.include_summary).to be(true)
  end

  it "updates an owned resume without a summary and refuses another user's resume" do
    resume = create(:resume, user: user)
    other = create(:resume)
    query = <<~GQL
      mutation($id: ID!) { updateResume(input: { id: $id, sections: [], includeSummary: false }) {
        resume { includeSummary } errors
      } }
    GQL
    result = execute_graphql(query, user: user, variables: { id: resume.id })
    expect(result.dig("data", "updateResume", "resume", "includeSummary")).to be(false)
    expect(resume.reload.include_summary).to be(false)
    rejected = execute_graphql(query, user: user, variables: { id: other.id })
    expect(rejected["errors"].first["message"]).to eq("Record not found")
    expect(other.reload.include_summary).to be(true)
  end

  it "rejects a null library default without a database error" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { updateProfile(input: { attributes: { includeSummary: null } }) { errors } }
    GQL
    expect(result.dig("data", "updateProfile", "errors")).not_to be_empty
    expect(user.reload.include_summary).to be(true)
  end
end
