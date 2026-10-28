# Description: The text embedded for each kind of career library entry, and that only the user's
# own entries are listed.
require "rails_helper"

RSpec.describe CareerLibrary::BuildEmbeddingTextsService do
  let(:user) { create(:user) }

  def texts
    described_class.call(user: user).value.to_h { |entry| [ entry[:source_type], entry[:content] ] }
  end

  it "gives each entry enough context to stand on its own" do
    experience = create(:experience, user: user, title: "Senior Engineer", company: "Acme", location: "Remote",
                                     description: "Payments  team")
    create(:experience_highlight, experience: experience, content: "Cut deploy time 40%")
    create(:project, user: user, name: "Throughline", role: "Creator", description: "Job search assistant")
    create(:education, user: user, institution: "State University", degree: "B.S.", field_of_study: "Computer Science")
    create(:skill, user: user, name: "Ruby", category: "Languages")

    expect(texts).to eq(
      "Experience" => "Senior Engineer at Acme (Remote): Payments team",
      "ExperienceHighlight" => "Senior Engineer at Acme: Cut deploy time 40%",
      "Project" => "Project: Throughline (Creator): Job search assistant",
      "Education" => "B.S. in Computer Science, State University",
      "Skill" => "Languages: Ruby"
    )
  end

  it "leaves out blank optional parts" do
    create(:experience, user: user, title: "Engineer", company: "Acme", location: nil, description: nil)
    create(:project, user: user, name: "Side project", role: nil, description: nil)
    create(:education, user: user, institution: "Bootcamp", degree: nil, field_of_study: nil, description: nil)
    create(:skill, user: user, name: "Go", category: nil)

    expect(texts).to eq(
      "Experience" => "Engineer at Acme", "Project" => "Project: Side project",
      "Education" => "Bootcamp", "Skill" => "Go"
    )
  end

  it "embeds library career_contexts and skips gap responses that stay on the job" do
    context = create(:career_context, user: user, requirement: "Kubernetes", response: "Used it at Acme for two years")
    create(:job_gap_response, job: create(:job, user: user), requirement: "Python", body: "Five years")

    expect(described_class.call(user: user).value).to eq(
      [ { source_type: "CareerContext", source_id: context.id, content: "Fact: Kubernetes: Used it at Acme for two years" } ]
    )
  end

  it "lists only the user's own entries, with their ids" do
    skill = create(:skill, user: user, name: "Ruby", category: "Languages")
    create(:skill, name: "Python")

    expect(described_class.call(user: user).value)
      .to eq([ { source_type: "Skill", source_id: skill.id, content: "Languages: Ruby" } ])
  end
end
