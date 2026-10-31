# Description: Importing a reviewed parsed resume into the career library and the user's profile.
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

  it "saves generated search titles only when accepting the import, ignoring client metadata" do
    ai_task.update!(result: ai_task.result.merge("job_title_suggestions" => [ " Backend engineer ", "backend engineer", "API developer" ]))
    expect(user.reload.job_title_suggestions).to eq([])
    parsed_resume["job_title_suggestions"] = [ "Invented chief executive" ]

    result = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(result).to be_success
    expect(user.reload.job_title_suggestions).to eq([ "Backend engineer", "API developer" ])
  end

  it "replaces suggestions on a later acceptance but never on replay of an accepted task" do
    ai_task.update!(result: ai_task.result.merge("job_title_suggestions" => [ "Backend engineer" ]))
    expect(described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)).to be_success
    later = create(:ai_task, :completed_resume_parse, user: user)
    later.update!(result: later.result.merge("job_title_suggestions" => [ "API developer" ]))
    expect(described_class.call(ai_task: later, parsed_resume: parsed_resume)).to be_success

    expect(described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)).not_to be_success
    expect(user.reload.job_title_suggestions).to eq([ "API developer" ])
  end

  [ nil, [], "wrong", [ 42 ], [ "", "x" * 101 ] ].each do |suggestions|
    it "preserves saved suggestions for unavailable optional metadata #{suggestions.inspect}" do
      user.update!(job_title_suggestions: [ "Existing role" ])
      ai_task.update!(result: ai_task.result.merge("job_title_suggestions" => suggestions))
      expect(described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)).to be_success
      expect(user.reload.job_title_suggestions).to eq([ "Existing role" ])
    end
  end

  it "bounds saved suggestions and rolls them back when career facts cannot be imported" do
    ai_task.update!(result: ai_task.result.merge("job_title_suggestions" => (1..8).map { |i| "Role #{i}" }))
    expect(described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)).to be_success
    expect(user.reload.job_title_suggestions).to eq((1..5).map { |i| "Role #{i}" })

    failed_task = create(:ai_task, :completed_resume_parse, user: user)
    failed_task.update!(result: failed_task.result.merge("job_title_suggestions" => [ "Replacement" ]))
    parsed_resume["experiences"] << { "company" => "", "title" => "Invalid" }
    expect(described_class.call(ai_task: failed_task, parsed_resume: parsed_resume)).not_to be_success
    expect(user.reload.job_title_suggestions).to eq((1..5).map { |i| "Role #{i}" })
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

  it "appends skills in submitted order while skipping existing and repeated names" do
    create(:skill, user: user, name: "Python", category: nil, position: 4)
    parsed_resume["skills"] = [
      { "name" => "python" },
      { "name" => "Ruby", "category" => "Languages" },
      { "name" => "RUBY", "category" => "Ignored duplicate" },
      { "name" => "SQL", "category" => "Databases" }
    ]
    user.skills.load

    result = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(result).to be_success
    expect(user.skills.reload.pluck(:name, :category, :position)).to eq([
      [ "Python", nil, 4 ], [ "Ruby", "Languages", 5 ], [ "SQL", "Databases", 6 ]
    ])
  end

  it "fills blank profile fields without overwriting existing ones and creates no resume" do
    user.update!(phone: "555-0100")
    parsed_resume["contact"].merge!("phone" => "555-9999", "location" => "Perth", "links" => [ { "label" => "GitHub", "url" => "https://github.com/jane" } ])

    result = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(result.value).to eq(ai_task)
    expect(user.reload).to have_attributes(
      name: "Jane Doe", contact_email: "jane@example.com", phone: "555-0100", location: "Perth",
      links: [ { "label" => "GitHub", "url" => "https://github.com/jane" } ], summary: "Backend engineer."
    )
    expect(user.resumes).to be_empty
  end

  it "merges entries that match the library instead of duplicating them" do
    described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)
    second_task = create(:ai_task, :completed_resume_parse, user: user)
    parsed_resume["experiences"][0]["highlights"] = [ "built the api", "Mentored two juniors" ]
    parsed_resume["experiences"] << { "company" => "Initech", "title" => "Intern", "start_date" => "2018" }
    parsed_resume["projects"] << { "name" => "SIDE PROJECT", "role" => "Author" }

    result = described_class.call(ai_task: second_task, parsed_resume: parsed_resume)

    expect(result).to be_success
    expect(user.experiences.pluck(:company)).to contain_exactly("Acme", "Globex", "Initech")
    acme = user.experiences.find_by!(company: "Acme")
    expect(acme.highlights.map(&:content)).to eq([ "Built the API", "Led the team", "Mentored two juniors" ])
    expect(user.projects.sole).to have_attributes(name: "Side project", role: "Author")
    expect(user.educations.count).to eq(1)
    expect(second_task.reload.result["import_summary"]).to eq("added" => 1, "merged" => 5)
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
    expect(user.reload.summary).to be_nil
    expect(ai_task.reload).not_to be_accepted
  end

  it "returns errors instead of crashing on a malformed parsed resume" do
    parsed_resume["experiences"] = { "company" => "Acme" }

    result = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(result.errors).to eq([ "experiences must be a list of objects" ])
    expect(user.experiences.reload).to be_empty
    expect(ai_task.reload).not_to be_accepted
  end

  it "only imports completed parse_resume tasks" do
    queued_task = create(:ai_task, user: user, task_type: "parse_resume", status: "queued")

    result = described_class.call(ai_task: queued_task, parsed_resume: parsed_resume)

    expect(result.errors).to eq([ "Only completed resume parsing tasks can be imported" ])
  end
end
