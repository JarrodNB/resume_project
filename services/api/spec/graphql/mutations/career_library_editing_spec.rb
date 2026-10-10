# Description: Career library create and update mutations: profile, projects, education, skills,
# and facts, including validation errors and ownership.
require "rails_helper"

RSpec.describe "Career library editing mutations" do
  let(:user) { create(:user, name: "Ada", location: "Seattle", links: [ { "label" => "Website", "url" => "https://ada.example" } ]) }

  it "updates the profile and clears blank strings" do
    result = execute_graphql(<<~GQL, user: user)
      mutation {
        updateProfile(input: { attributes: { name: "  ", phone: "555", links: [{ label: " Website ", url: " https://ada.example " }, { label: "", url: "" }] } }) {
          user { name phone location links { label url } }
          errors
        }
      }
    GQL

    payload = result.dig("data", "updateProfile")
    expect(payload["errors"]).to eq([])
    expect(payload["user"]).to eq(
      "name" => nil, "phone" => "555", "location" => "Seattle", "links" => [ { "label" => "Website", "url" => "https://ada.example" } ]
    )
    expect(user.reload.email).to end_with("@example.com")
  end

  it "creates and updates a project, and leaves omitted fields alone" do
    created = execute_graphql(<<~GQL, user: user)
      mutation {
        createProject(input: { attributes: { name: "CLI", role: "Author", startDate: "2024-01-15" } }) {
          project { id name role startDate }
          errors
        }
      }
    GQL
    project = created.dig("data", "createProject", "project")
    expect(created.dig("data", "createProject", "errors")).to eq([])
    expect(project["startDate"]).to eq("2024-01-15")

    updated = execute_graphql(<<~GQL, user: user, variables: { id: project["id"] })
      mutation($id: ID!) {
        updateProject(input: { id: $id, attributes: { role: null } }) {
          project { name role }
          errors
        }
      }
    GQL

    expect(updated.dig("data", "updateProject", "project")).to eq("name" => "CLI", "role" => nil)
  end

  it "returns validation errors when a project has no name" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { createProject(input: { attributes: { role: "Author" } }) { project { id } errors } }
    GQL

    payload = result.dig("data", "createProject")
    expect(payload["project"]).to be_nil
    expect(payload["errors"]).to include("Name can't be blank")
  end

  it "cannot update another user's project" do
    theirs = create(:project)

    result = execute_graphql(<<~GQL, user: user, variables: { id: theirs.id })
      mutation($id: ID!) { updateProject(input: { id: $id, attributes: { name: "Mine" } }) { project { id } errors } }
    GQL

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(theirs.reload.name).to eq("Open source CLI tool")
  end

  it "creates and updates an education" do
    created = execute_graphql(<<~GQL, user: user)
      mutation {
        createEducation(input: { attributes: { institution: "State", degree: "BSc", fieldOfStudy: "CS" } }) {
          education { id institution fieldOfStudy }
          errors
        }
      }
    GQL
    education = created.dig("data", "createEducation", "education")
    expect(education["fieldOfStudy"]).to eq("CS")

    updated = execute_graphql(<<~GQL, user: user, variables: { id: education["id"] })
      mutation($id: ID!) {
        updateEducation(input: { id: $id, attributes: { degree: null } }) {
          education { institution degree }
          errors
        }
      }
    GQL

    expect(updated.dig("data", "updateEducation", "education")).to eq("institution" => "State", "degree" => nil)
  end

  it "cannot update another user's education" do
    theirs = create(:education)

    result = execute_graphql(<<~GQL, user: user, variables: { id: theirs.id })
      mutation($id: ID!) {
        updateEducation(input: { id: $id, attributes: { institution: "Mine" } }) { education { id } errors }
      }
    GQL

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(theirs.reload.institution).to eq("State University")
  end

  it "appends a skill and rejects a duplicate name" do
    create(:skill, user: user, name: "Ruby", position: 0)

    created = execute_graphql(<<~GQL, user: user)
      mutation {
        createSkill(input: { attributes: { name: "Go", category: "Languages" } }) {
          skill { name position }
          errors
        }
      }
    GQL
    expect(created.dig("data", "createSkill", "skill")).to eq("name" => "Go", "position" => 1)

    duplicate = execute_graphql(<<~GQL, user: user)
      mutation { createSkill(input: { attributes: { name: "ruby" } }) { skill { id } errors } }
    GQL
    expect(duplicate.dig("data", "createSkill", "skill")).to be_nil
    expect(duplicate.dig("data", "createSkill", "errors")).to include("Name has already been taken")
  end

  it "updates a skill without moving it, and cannot update another user's skill" do
    skill = create(:skill, user: user, name: "Ruby", position: 3)
    theirs = create(:skill)

    updated = execute_graphql(<<~GQL, user: user, variables: { id: skill.id })
      mutation($id: ID!) {
        updateSkill(input: { id: $id, attributes: { category: null } }) { skill { name category position } errors }
      }
    GQL
    expect(updated.dig("data", "updateSkill", "skill")).to eq("name" => "Ruby", "category" => nil, "position" => 3)

    denied = execute_graphql(<<~GQL, user: user, variables: { id: theirs.id })
      mutation($id: ID!) { updateSkill(input: { id: $id, attributes: { name: "Mine" } }) { skill { id } errors } }
    GQL
    expect(denied["errors"].first["message"]).to eq("Record not found")
  end

  it "creates and updates a library fact" do
    created = execute_graphql(<<~GQL, user: user)
      mutation {
        createLibraryFact(input: { attributes: { requirement: "Kubernetes", response: "Used it at Acme" } }) {
          libraryFact { id requirement response }
          errors
        }
      }
    GQL
    fact = created.dig("data", "createLibraryFact", "libraryFact")
    expect(created.dig("data", "createLibraryFact", "errors")).to eq([])

    updated = execute_graphql(<<~GQL, user: user, variables: { id: fact["id"] })
      mutation($id: ID!) {
        updateLibraryFact(input: { id: $id, attributes: { response: "Used it for two years" } }) {
          libraryFact { requirement response }
          errors
        }
      }
    GQL
    expect(updated.dig("data", "updateLibraryFact", "libraryFact")).to eq(
      "requirement" => "Kubernetes", "response" => "Used it for two years"
    )
  end

  it "cannot update another user's library fact" do
    theirs = create(:library_fact)

    result = execute_graphql(<<~GQL, user: user, variables: { id: theirs.id })
      mutation($id: ID!) {
        updateLibraryFact(input: { id: $id, attributes: { response: "Mine" } }) { libraryFact { id } errors }
      }
    GQL

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(theirs.reload.response).to eq("I used Kubernetes at Acme for two years")
  end
end
