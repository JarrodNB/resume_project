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
end
