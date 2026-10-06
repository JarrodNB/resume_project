# Description: Career library merge and delete mutations, including ownership of every id.
require "rails_helper"

RSpec.describe "Career library mutations" do
  let(:user) { create(:user) }

  it "mergeExperiences merges the source into the target and removes it" do
    target = create(:experience, user: user, location: nil)
    source = create(:experience, user: user, location: "Perth")
    create(:experience_highlight, experience: source, content: "Led the team")

    result = execute_graphql(<<~GQL, user: user, variables: { targetId: target.id, sourceId: source.id })
      mutation($targetId: ID!, $sourceId: ID!) {
        mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) {
          experience { id location highlights { content } }
          errors
        }
      }
    GQL

    expect(result.dig("data", "mergeExperiences")).to eq(
      "experience" => { "id" => target.id, "location" => "Perth", "highlights" => [ { "content" => "Led the team" } ] },
      "errors" => []
    )
    expect(Experience.exists?(source.id)).to be(false)
  end

  it "mergeProjects and mergeEducations return the kept record" do
    project_target, project_source = create_list(:project, 2, user: user)
    education_target, education_source = create_list(:education, 2, user: user)

    variables = {
      projectTarget: project_target.id, projectSource: project_source.id,
      educationTarget: education_target.id, educationSource: education_source.id
    }
    result = execute_graphql(<<~GQL, user: user, variables: variables)
      mutation($projectTarget: ID!, $projectSource: ID!, $educationTarget: ID!, $educationSource: ID!) {
        mergeProjects(input: { targetId: $projectTarget, sourceId: $projectSource }) { project { id } errors }
        mergeEducations(input: { targetId: $educationTarget, sourceId: $educationSource }) { education { id } errors }
      }
    GQL

    expect(result.dig("data", "mergeProjects")).to eq("project" => { "id" => project_target.id }, "errors" => [])
    expect(result.dig("data", "mergeEducations")).to eq("education" => { "id" => education_target.id }, "errors" => [])
    expect(user.projects.count).to eq(1)
    expect(user.educations.count).to eq(1)
  end

  it "returns an error when merging an entry into itself" do
    project = create(:project, user: user)

    result = execute_graphql(<<~GQL, user: user, variables: { id: project.id })
      mutation($id: ID!) { mergeProjects(input: { targetId: $id, sourceId: $id }) { project { id } errors } }
    GQL

    expect(result.dig("data", "mergeProjects")).to eq("project" => nil, "errors" => [ "An entry can't be merged into itself" ])
  end

  it "can't merge another user's entry as the target or the source" do
    mine = create(:experience, user: user)
    theirs = create(:experience)
    query = <<~GQL
      mutation($targetId: ID!, $sourceId: ID!) {
        mergeExperiences(input: { targetId: $targetId, sourceId: $sourceId }) { errors }
      }
    GQL

    [ [ theirs.id, mine.id ], [ mine.id, theirs.id ] ].each do |target_id, source_id|
      result = execute_graphql(query, user: user, variables: { targetId: target_id, sourceId: source_id })
      expect(result["errors"].first["message"]).to eq("Record not found")
    end
    expect(Experience.where(id: [ mine.id, theirs.id ]).count).to eq(2)
  end

  it "deletes the user's projects, educations, and skills" do
    project = create(:project, user: user)
    education = create(:education, user: user)
    skill = create(:skill, user: user)

    result = execute_graphql(<<~GQL, user: user, variables: { project: project.id, education: education.id, skill: skill.id })
      mutation($project: ID!, $education: ID!, $skill: ID!) {
        deleteProject(input: { id: $project }) { errors }
        deleteEducation(input: { id: $education }) { errors }
        deleteSkill(input: { id: $skill }) { errors }
      }
    GQL

    expect(result["data"].values).to all(eq("errors" => []))
    expect([ user.projects.count, user.educations.count, user.skills.count ]).to eq([ 0, 0, 0 ])
  end

  it "can't delete another user's project, education, or skill" do
    { "deleteProject" => create(:project), "deleteEducation" => create(:education), "deleteSkill" => create(:skill) }
      .each do |mutation_name, record|
        result = execute_graphql(<<~GQL, user: user, variables: { id: record.id })
          mutation($id: ID!) { #{mutation_name}(input: { id: $id }) { errors } }
        GQL

        expect(result["errors"].first["message"]).to eq("Record not found")
        expect(record.class.exists?(record.id)).to be(true)
      end
  end

  it "clearCareerLibrary empties only the signed-in user's library" do
    create(:experience, user: user, company: "Mine")
    create(:skill, user: user, name: "Ruby")
    theirs = create(:experience, company: "Theirs")

    result = execute_graphql(<<~GQL, user: user)
      mutation { clearCareerLibrary(input: {}) { user { name } errors } }
    GQL

    expect(result.dig("data", "clearCareerLibrary")).to eq("user" => { "name" => nil }, "errors" => [])
    expect(user.experiences.count).to eq(0)
    expect(user.skills.count).to eq(0)
    expect(Experience.exists?(theirs.id)).to be(true)
  end
end
