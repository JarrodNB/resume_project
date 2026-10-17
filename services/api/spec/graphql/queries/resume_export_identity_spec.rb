# A saved editor receives identity with its content, including before any ATS run exists.
require "rails_helper"

RSpec.describe "Saved resume export identity" do
  let(:user) { create(:user) }
  let(:resume) { create(:resume, user: user) }
  let(:query) { "query($id: ID!) { resume(id: $id) { atsContentFingerprint sections { id content } } }" }

  it "returns the saved content fingerprint without requiring an ATS report" do
    section = create(:resume_section, resume: resume, content: { "text" => "Engineer" })
    result = execute_graphql(query, user: user, variables: { id: resume.id })
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "resume", "atsContentFingerprint")).to eq(AtsChecks::Snapshot.fingerprint(AtsChecks::Snapshot.content(resume)))
    section.update!(content: { "text" => "Changed in another tab" })
    changed = execute_graphql(query, user: user, variables: { id: resume.id })
    expect(changed.dig("data", "resume", "atsContentFingerprint")).not_to eq(result.dig("data", "resume", "atsContentFingerprint"))
  end

  it "does not expose another user's saved content identity" do
    result = execute_graphql(query, user: create(:user), variables: { id: resume.id })
    expect(result["errors"].first["message"]).to eq("Record not found")
  end
end
