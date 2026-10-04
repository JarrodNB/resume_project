# Description: reorderSkills and moveExperienceHighlight mutations, including ownership.
require "rails_helper"

RSpec.describe "Career library reordering mutations" do
  let(:user) { create(:user) }

  it "reorderSkills saves the new order of the user's skills" do
    ruby = create(:skill, user: user, name: "Ruby", position: 0)
    react = create(:skill, user: user, name: "React", position: 1)

    result = execute_graphql(<<~GQL, user: user, variables: { ids: [ react.id, ruby.id ] })
      mutation($ids: [ID!]!) { reorderSkills(input: { orderedIds: $ids }) { errors } }
    GQL

    expect(result.dig("data", "reorderSkills")).to eq("errors" => [])
    expect(user.skills.reload.pluck(:name)).to eq(%w[React Ruby])
  end

  it "reorderSkills rejects another user's skill" do
    mine = create(:skill, user: user)
    theirs = create(:skill)

    result = execute_graphql(<<~GQL, user: user, variables: { ids: [ theirs.id, mine.id ] })
      mutation($ids: [ID!]!) { reorderSkills(input: { orderedIds: $ids }) { errors } }
    GQL

    expect(result.dig("data", "reorderSkills", "errors")).to eq([ "The new order must list each entry exactly once" ])
    expect(mine.reload.position).to eq(0)
  end

  it "moveExperienceHighlight moves a highlight and returns both roles" do
    source = create(:experience, user: user)
    target = create(:experience, user: user)
    highlight = create(:experience_highlight, experience: source, content: "Led the team")

    result = execute_graphql(<<~GQL, user: user, variables: { highlightId: highlight.id, experienceId: target.id })
      mutation($highlightId: ID!, $experienceId: ID!) {
        moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: 0 }) {
          experience { id highlights { id content position } }
          sourceExperience { id highlights { id } }
          errors
        }
      }
    GQL

    expect(result.dig("data", "moveExperienceHighlight")).to eq(
      "experience" => { "id" => target.id, "highlights" => [ { "id" => highlight.id, "content" => "Led the team", "position" => 0 } ] },
      "sourceExperience" => { "id" => source.id, "highlights" => [] },
      "errors" => []
    )
  end

  it "moveExperienceHighlight can't touch another user's highlight or role" do
    mine = create(:experience, user: user)
    my_highlight = create(:experience_highlight, experience: mine)
    their_highlight = create(:experience_highlight)
    query = <<~GQL
      mutation($highlightId: ID!, $experienceId: ID!) {
        moveExperienceHighlight(input: { highlightId: $highlightId, experienceId: $experienceId, position: 0 }) { errors }
      }
    GQL

    [ [ their_highlight.id, mine.id ], [ my_highlight.id, their_highlight.experience_id ] ].each do |highlight_id, experience_id|
      result = execute_graphql(query, user: user, variables: { highlightId: highlight_id, experienceId: experience_id })
      expect(result["errors"].first["message"]).to eq("Record not found")
    end
    expect(my_highlight.reload.experience_id).to eq(mine.id)
    expect(their_highlight.reload.experience_id).not_to eq(mine.id)
  end
end
