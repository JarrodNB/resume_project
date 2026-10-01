# Description: Importing a reviewed parsed resume into the career library and a base resume.
require "rails_helper"

RSpec.describe ResumeImports::ImportParsedResumeService do
  let(:user) { create(:user, name: nil) }
  let(:ai_task) { create(:ai_task, :completed_resume_parse, user: user) }
  let(:parsed_resume) do
    {
      "contact" => { "full_name" => "Jane Doe", "email" => "jane@example.com", "links" => [] },
      "summary" => "Backend engineer.",
      "experiences" => [
        {
          "company" => "Acme", "title" => "Senior Engineer", "start_date" => "2022-03",
          "end_date" => "2024-01", "is_current" => true, "highlights" => [ "Built the API", "Led the team" ]
        },
        { "company" => "Globex", "title" => "Engineer", "start_date" => "2019", "end_date" => "2022-02" }
      ],
      "projects" => [ { "name" => "Side project", "url" => "github.com/jane/side" } ],
      "educations" => [ { "institution" => "State University", "degree" => "B.S.", "end_date" => "2019" } ],
      "skills" => [ { "name" => "Ruby", "category" => "Languages" }, { "name" => "python" } ],
      "parsing_warnings" => []
    }
  end

  it "creates library records with converted dates and ordered highlights" do
    create(:experience, user: user, position: 0)
    create(:skill, user: user, name: "Python")

    result = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(result).to be_success
    acme = user.experiences.find_by!(company: "Acme")
    expect(acme).to have_attributes(start_date: Date.new(2022, 3, 1), end_date: nil, position: 1)
    expect(acme.highlights.map(&:content)).to eq([ "Built the API", "Led the team" ])
    expect(user.experiences.find_by!(company: "Globex").start_date).to eq(Date.new(2019, 1, 1))
    expect(user.projects.sole).to have_attributes(name: "Side project", url: "github.com/jane/side")
    expect(user.educations.sole).to have_attributes(institution: "State University", end_date: Date.new(2019, 1, 1))
    expect(user.skills.pluck(:name)).to contain_exactly("Python", "Ruby")
    expect(user.reload.name).to eq("Jane Doe")
  end

  it "creates a base resume whose sections snapshot the import" do
    resume = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume).value

    expect(resume).to be_base
    expect(resume.sections.map(&:section_type)).to eq(%w[contact summary experience projects education skills])
    experience_items = resume.sections.find_by!(section_type: "experience").content["items"]
    expect(experience_items.first).to include("company" => "Acme", "highlights" => [ "Built the API", "Led the team" ])
    expect(resume.sections.find_by!(section_type: "summary").content).to eq("text" => "Backend engineer.")
  end

  it "marks the task accepted and refuses to import it twice" do
    described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    second = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(ai_task.reload).to be_accepted
    expect(second.errors).to eq([ "This resume has already been imported" ])
    expect(user.experiences.count).to eq(2)
  end

  it "rolls back everything when a record is invalid" do
    parsed_resume["experiences"] << { "company" => "", "title" => "Ghost" }

    result = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(result.errors).to eq([ "Company can't be blank" ])
    expect(user.experiences.reload).to be_empty
    expect(user.resumes.reload).to be_empty
    expect(ai_task.reload).not_to be_accepted
  end

  it "only imports completed parse_resume tasks" do
    queued_task = create(:ai_task, user: user, task_type: "parse_resume", status: "queued")

    result = described_class.call(ai_task: queued_task, parsed_resume: parsed_resume)

    expect(result.errors).to eq([ "Only completed resume parsing tasks can be imported" ])
  end
end
