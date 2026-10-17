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

  it "pairs sections and identity when another save lands between field resolutions" do
    section = create(:resume_section, resume: resume, content: { "text" => "Version A" })
    expected = AtsChecks::Snapshot.fingerprint(AtsChecks::Snapshot.content(resume))
    allow_any_instance_of(Types::ResumeType).to receive(:ats_content_fingerprint).and_wrap_original do |method|
      ResumeSection.where(id: section.id).update_all(content: { "text" => "Version B" })
      method.call
    end
    query = "query($id: ID!) { resume(id: $id) { sections { id content } atsReport { runId } atsContentFingerprint } }"
    data = execute_graphql(query, user: user, variables: { id: resume.id }).dig("data", "resume")
    expect(data["sections"].first["content"]).to eq("text" => "Version A")
    expect(data["atsContentFingerprint"]).to eq(expected)
  end

  it "retains the mutation's saved version when another save commits before its response" do
    section = create(:resume_section, resume: resume, content: { "text" => "Before" })
    allow_any_instance_of(Types::ResumeType).to receive(:ats_content_fingerprint).and_wrap_original do |method|
      ResumeSection.where(id: section.id).update_all(content: { "text" => "Concurrent B" })
      method.call
    end
    mutation = <<~GRAPHQL
      mutation($id: ID!, $sections: JSON!) {
        updateResume(input: {id: $id, sections: $sections}) {
          resume { atsContentFingerprint atsReport { runId } sections { id sectionType title position content } }
          errors
        }
      }
    GRAPHQL
    result = execute_graphql(mutation, user: user, variables: {
      id: resume.id, sections: [{ id: section.id, content: { text: "Saved A" } }]
    })
    expect(result["errors"]).to be_nil
    data = result.dig("data", "updateResume", "resume")
    expect(data["sections"].first["content"]).to eq("text" => "Saved A")
    snapshot = data["sections"].map do |item|
      item.except("sectionType").merge("section_type" => item["sectionType"].downcase)
    end
    expect(data["atsContentFingerprint"]).to eq(AtsChecks::Snapshot.fingerprint(snapshot))
    expect(section.reload.content["text"]).to eq("Concurrent B")
  end
end
