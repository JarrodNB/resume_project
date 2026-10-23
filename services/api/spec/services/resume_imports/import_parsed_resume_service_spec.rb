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

  it "creates library records with converted dates and ordered highlights" do
    create(:experience, user: user, position: 0)
    create(:skill, user: user, name: "Python")

    result = described_class.call(ai_task: ai_task, parsed_resume: parsed_resume)

    expect(result).to be_success
    acme = user.experiences.find_by!(company: "Acme")
    expect(acme).to have_attributes(start_date: Date.new(2022, 3, 1), end_date: nil, position: 1)
    expect(acme.highlights.map(&:content)).to eq([ "Built the API", "Led the team" ])
    expect(acme.roles.sole.title).to eq("Senior Engineer")
    expect(acme.highlights.map(&:experience_role_id).uniq).to eq([ acme.roles.sole.id ])
    expect(user.experiences.find_by!(company: "Globex").start_date).to eq(Date.new(2019, 1, 1))
    expect(user.projects.sole).to have_attributes(name: "Side project", url: "github.com/jane/side")
    expect(user.educations.sole).to have_attributes(institution: "State University", end_date: Date.new(2019, 1, 1))
    expect(user.skills.pluck(:name)).to contain_exactly("Python", "Ruby")
    expect(user.reload.name).to eq("Jane Doe")
  end

  it "keeps a legacy flat description on its single role" do
    payload = { "experiences" => [ {
      "company" => "Acme", "title" => "Engineer", "description" => "Built internal developer tools",
      "highlights" => [ "Shipped deployment tooling" ]
    } ] }

    expect(described_class.call(ai_task: ai_task, parsed_resume: payload)).to be_success

    entry = user.experiences.sole
    expect(entry.description).to be_nil
    expect(entry.roles.sole.description).to eq("Built internal developer tools")
  end

  it "preserves grouped roles and mixed bullet scopes without changing task JSON" do
    payload = { "experiences" => [ { "company" => "Acme", "description" => "Company context",
      "roles" => [
        { "title" => "Lead", "start_date" => "2023-02", "is_current" => true,
          "description" => "Role context", "highlights" => [ "Led delivery" ] },
        { "title" => "Engineer", "start_date" => "2020", "end_date" => "2023-01", "highlights" => [ "Built API" ] }
      ], "shared_highlights" => [ "Won team award" ] } ] }
    original_result = ai_task.result.deep_dup

    result = described_class.call(ai_task: ai_task, parsed_resume: payload)

    expect(result).to be_success
    entry = user.experiences.sole
    expect(entry.description).to eq("Company context")
    expect(entry.roles.map(&:title)).to eq([ "Lead", "Engineer" ])
    expect(entry.roles.first).to have_attributes(start_date: Date.new(2023, 2, 1), end_date: nil, description: "Role context")
    expect(entry.roles.last).to have_attributes(start_date: Date.new(2020, 1, 1), end_date: Date.new(2023, 1, 1))
    expect(entry.roles.map { |role| role.highlights.map(&:content) }).to eq([ [ "Led delivery" ], [ "Built API" ] ])
    expect(entry.highlights.where(experience_role_id: nil).pluck(:content)).to eq([ "Won team award" ])
    expect(ai_task.reload.result.except("import_summary")).to eq(original_result)
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

  it "keeps repeated incoming source blocks separate and uses each preexisting match once" do
    block = { "company" => "Acme", "roles" => [ { "title" => "Engineer", "start_date" => "2020", "highlights" => [ "Built systems" ] } ],
              "shared_highlights" => [] }
    payload = { "experiences" => [ block.deep_dup, block.deep_dup ] }
    first_task = ai_task
    expect(described_class.call(ai_task: first_task, parsed_resume: payload)).to be_success
    expect(user.experiences.count).to eq(2)
    original_ids = user.experiences.pluck(:id)

    second_task = create(:ai_task, :completed_resume_parse, user: user)
    payload["experiences"] << block.deep_dup
    expect(described_class.call(ai_task: second_task, parsed_resume: payload)).to be_success

    expect(user.experiences.count).to eq(3)
    expect(user.experiences.where(id: original_ids).count).to eq(2)
    expect(second_task.reload.result["import_summary"]).to eq("added" => 1, "merged" => 2)
    expect(user.experiences.map { |entry| entry.highlights.map(&:content) }).to all(eq([ "Built systems" ]))
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

  it "rolls back grouped entries and profile fills if a later role is invalid" do
    payload = { "contact" => { "full_name" => "Jane" }, "experiences" => [
      { "company" => "Acme", "roles" => [ { "title" => "Engineer", "highlights" => [ "Built API" ] } ] },
      { "company" => "Globex", "roles" => [ { "title" => "" } ] }
    ] }

    result = described_class.call(ai_task: ai_task, parsed_resume: payload)

    expect(result).not_to be_success
    expect(user.experiences.reload).to be_empty
    expect(user.reload.name).to be_nil
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
