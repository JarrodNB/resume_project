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
      "Experience" => "Acme (Remote): Payments team; Senior Engineer at Acme (2022-01-01)",
      "ExperienceHighlight" => "Senior Engineer at Acme (2022-01-01): Cut deploy time 40%",
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
      "Experience" => "Acme; Engineer at Acme (2022-01-01)", "Project" => "Project: Side project",
      "Education" => "Bootcamp", "Skill" => "Go"
    )
  end

  it "embeds library facts and skips gap responses that stay on the job" do
    fact = create(:library_fact, user: user, requirement: "Kubernetes", response: "Used it at Acme for two years")
    create(:job_gap_response, job: create(:job, user: user), requirement: "Python", body: "Five years")

    expect(described_class.call(user: user).value).to eq(
      [ { source_type: "LibraryFact", source_id: fact.id, content: "Fact: Kubernetes: Used it at Acme for two years" } ]
    )
  end

  it "lists only the user's own entries, with their ids" do
    skill = create(:skill, user: user, name: "Ruby", category: "Languages")
    create(:skill, name: "Python")

    expect(described_class.call(user: user).value)
      .to eq([ { source_type: "Skill", source_id: skill.id, content: "Languages: Ruby" } ])
  end
  it "keeps shared bullets at company scope and exact role bullets at their title and dates" do
    experience = create(:experience, user: user, company: "Acme", title: "Lead", description: "Company work")
    junior = experience.roles.create!(title: "Developer", start_date: "2019-01-01", end_date: "2024-12-01", position: 1)
    lead = experience.roles.first.tap { |role| role.update!(title: "Lead", start_date: "2025-01-01", description: "Managed team") }
    shared = experience.highlights.create!(content: "Shared achievement", position: 0)
    scoped = experience.highlights.create!(content: "Early achievement", experience_role: junior, position: 1)
    entries = described_class.call(user: user).value.index_by { |entry| entry[:source_id] }
    expect(entries.keys).to contain_exactly(experience.id, shared.id, scoped.id)
    expect(entries[shared.id][:content]).to eq("Acme: Shared achievement")
    expect(entries[scoped.id][:content]).to eq("Developer at Acme (2019-01-01 – 2024-12-01): Early achievement")
    expect(entries[experience.id][:content]).to include("Lead", "Developer", "2025-01-01", "Managed team", "Company work")
    expect(entries[experience.id][:content].index("Lead")).to be < entries[experience.id][:content].index("Developer")
  end

end
