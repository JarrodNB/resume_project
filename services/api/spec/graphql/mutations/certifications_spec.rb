# Description: Certification lifecycle, validations and user-scoped GraphQL authorization.
# Index: creation, update, listing, merge, deletion and ownership examples
require "rails_helper"

RSpec.describe "Certification mutations" do
  let(:user) { create(:user) }

  it "creates and updates credentials without changing education" do
    education = create(:education, user: user)
    result = execute_graphql(<<~GQL, user: user)
      mutation { createCertification(input: { attributes: { name: "AWS", issuer: "Amazon", issuedDate: "2024-02-03", credentialUrl: "https://example.com/credential" } }) {
        certification { id name issuedDate credentialUrl } errors
      } }
    GQL
    payload = result.dig("data", "createCertification")
    expect(payload["errors"]).to eq([])
    certification = payload["certification"]
    expect(certification["issuedDate"]).to eq("2024-02-03")
    updated = execute_graphql(<<~GQL, user: user, variables: { id: certification["id"] })
      mutation($id: ID!) { updateCertification(input: { id: $id, attributes: { issuer: null, credentialId: "123" } }) { certification { name issuer credentialId } errors } }
    GQL
    expect(updated.dig("data", "updateCertification", "certification")).to eq("name" => "AWS", "issuer" => nil, "credentialId" => "123")
    expect(user.educations.sole).to eq(education)
  end

  it "requires a name and caps strings" do
    result = execute_graphql('mutation { createCertification(input: { attributes: {} }) { errors } }', user: user)
    expect(result.dig("data", "createCertification", "errors")).to include("Name can't be blank")
    expect(build(:certification, name: "x" * (TextLimits::SHORT + 1))).not_to be_valid
  end

  it "lists only owned credentials and merges missing facts before deleting the source" do
    target = create(:certification, user: user)
    source = create(:certification, user: user, credential_id: "ABC", description: "Exam passed")
    theirs = create(:certification)
    listed = execute_graphql('{ certifications { id } }', user: user)
    expect(listed.dig("data", "certifications").pluck("id")).to contain_exactly(target.id, source.id)
    merged = execute_graphql(<<~GQL, user: user, variables: { target: target.id, source: source.id })
      mutation($target: ID!, $source: ID!) { mergeCertifications(input: { targetId: $target, sourceId: $source }) { certification { id credentialId } errors } }
    GQL
    expect(merged.dig("data", "mergeCertifications", "errors")).to eq([])
    expect(target.reload.credential_id).to eq("ABC")
    expect(Certification.exists?(source.id)).to be(false)
    deleted = execute_graphql(<<~GQL, user: user, variables: { id: target.id })
      mutation($id: ID!) { deleteCertification(input: { id: $id }) { certification { id } errors } }
    GQL
    expect(deleted.dig("data", "deleteCertification", "errors")).to eq([])
    expect(theirs.reload).to be_persisted
  end

  it "rejects cross-user update, delete and merge" do
    theirs = create(:certification)
    mine = create(:certification, user: user)
    operations = [
      'updateCertification(input: { id: $id, attributes: { name: "Mine" } })',
      'deleteCertification(input: { id: $id })',
      "mergeCertifications(input: { targetId: \"#{mine.id}\", sourceId: $id })"
    ]
    operations.each do |operation|
      result = execute_graphql("mutation($id: ID!) { #{operation} { errors } }", user: user, variables: { id: theirs.id })
      expect(result["errors"].first["message"]).to eq("Record not found")
    end
    expect(theirs.reload.name).to eq("AWS Solutions Architect")
  end
end
