# Description: Experience mutations: create with highlights, update replacing highlights, delete.
require "rails_helper"

RSpec.describe "Experience mutations" do
  let(:user) { create(:user) }

  it "creates an experience with ordered highlights" do
    result = execute_graphql(<<~GQL, user: user)
      mutation {
        createExperience(input: {
          attributes: { company: "Acme", title: "Engineer", startDate: "2023-02-01" },
          highlights: ["Built the thing", "Scaled the thing"]
        }) {
          experience { company startDate highlights { content position } }
          errors
        }
      }
    GQL

    experience = result.dig("data", "createExperience", "experience")
    expect(experience["startDate"]).to eq("2023-02-01")
    expect(experience["highlights"]).to eq([
      { "content" => "Built the thing", "position" => 0 },
      { "content" => "Scaled the thing", "position" => 1 }
    ])
  end

  it "updates an experience and replaces its highlights" do
    experience = create(:experience, user: user)
    create(:experience_highlight, experience: experience, content: "Old")

    result = execute_graphql(<<~GQL, user: user, variables: { id: experience.id })
      mutation($id: ID!) {
        updateExperience(input: { id: $id, attributes: { title: "Lead" }, highlights: ["New"] }) {
          experience { title highlights { content } }
          errors
        }
      }
    GQL

    expect(result.dig("data", "updateExperience", "experience")).to eq(
      "title" => "Lead", "highlights" => [ { "content" => "New" } ]
    )
  end

  it "deletes an experience" do
    experience = create(:experience, user: user)

    execute_graphql(<<~GQL, user: user, variables: { id: experience.id })
      mutation($id: ID!) { deleteExperience(input: { id: $id }) { errors } }
    GQL

    expect(Experience.exists?(experience.id)).to be(false)
  end

  it "exposes canonical roles and stable bullet ownership through the legacy create mutation" do
    result = execute_graphql(<<~GQL, user: user)
      mutation {
        createExperience(input: { attributes: { company: "Acme", title: "Engineer" }, highlights: ["Built"] }) {
          experience { roles { id title position } highlights { id content experienceRoleId } }
          errors
        }
      }
    GQL
    entry = result.dig("data", "createExperience", "experience")
    role = entry.fetch("roles").first
    expect(role.slice("title", "position")).to eq("title" => "Engineer", "position" => 0)
    expect(entry.fetch("highlights").first.fetch("experienceRoleId")).to eq(role.fetch("id"))
  end

  it "rejects another user's legacy update before canonical or bullet writes" do
    entry = Experiences::CreateExperienceService.call(user: create(:user),
      attributes: { company: "Other", title: "Engineer" }, highlights: [ "Private" ]).value
    result = execute_graphql(<<~GQL, user: user)
      mutation {
        updateExperience(input: { id: "#{entry.id}", attributes: { title: "Changed" }, highlights: ["New"] }) {
          experience { id } errors
        }
      }
    GQL
    expect(result.to_s).to include("Record not found")
    expect(entry.reload.roles.first.title).to eq("Engineer")
    expect(entry.highlights.pluck(:content)).to eq([ "Private" ])
  end

  it "does not flatten grouped roles into a single compatibility title or date" do
    entry = create(:experience, user: user, title: "Old projection", start_date: Date.new(2000, 1, 1))
    entry.roles.first.update!(title: "Canonical")
    entry.roles.create!(title: "Earlier role", position: 1, start_date: Date.new(2020, 1, 1))
    result = execute_graphql(<<~GQL, user: user)
      query { experiences { id title startDate roles { title position } } }
    GQL
    expect(result["errors"]).to be_nil
    experience = result.fetch("data").fetch("experiences").find { |item| item["id"] == entry.id }
    expect(experience.fetch("title")).to be_nil
    expect(experience.fetch("startDate")).to be_nil
    expect(experience.fetch("roles").map { |role| role["title"] }).to eq([ "Canonical", "Earlier role" ])
  end
end

RSpec.describe "Grouped experience mutations" do
  let(:user) { create(:user) }

  it "creates nested roles and reads scope through GraphQL, then rejects foreign child IDs" do
    result = execute_graphql(<<~GQL, user: user)
      mutation {
        createExperience(input: {attributes: {company: "Example", roles: [
          {title: "Lead", highlights: [{content: "Role bullet"}]}, {title: "Engineer"}
        ], sharedHighlights: [{content: "Shared"}]}}) {
          experience {id roles {id title} highlights {id content experienceRoleId}} errors
        }
      }
    GQL
    expect(result["errors"]).to be_nil
    payload = result.dig("data", "createExperience")
    expect(payload["errors"]).to eq([])
    entry = payload.fetch("experience")
    expect(entry["roles"].map { |role| role["title"] }).to eq([ "Lead", "Engineer" ])
    expect(entry["highlights"].find { |bullet| bullet["content"] == "Role bullet" }["experienceRoleId"]).to eq(entry["roles"].first["id"])
    foreign = Experiences::CreateExperienceService.call(user: create(:user), attributes: { company: "Private", title: "Secret" }).value
    result = execute_graphql(<<~GQL, user: user)
      mutation { updateExperience(input: {id: "#{entry['id']}", attributes: {roles: [{id: "#{foreign.roles.first.id}", title: "Changed"}]}}) {errors} }
    GQL
    expect(result.dig("data", "updateExperience", "errors")).to include("Role IDs must be unique and belong to this experience")
    expect(foreign.reload.roles.first.title).to eq("Secret")
  end
end
