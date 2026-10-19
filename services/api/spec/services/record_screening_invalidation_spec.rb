# Checks screening reuse through library edits, merges, imports, and gap-answer saves.
require "rails_helper"

RSpec.describe "Career library screening state" do
  let(:user) { create(:user) }

  it "forgets only changed fields through each text update service" do
    [
      [ :experience, Experiences::UpdateExperienceService, :experience, :title, :company ],
      [ :project, Projects::UpdateProjectService, :project, :name, :description ],
      [ :education, Educations::UpdateEducationService, :education, :institution, :degree ],
      [ :certification, Certifications::UpdateCertificationService, :certification, :name, :issuer ],
      [ :skill, Skills::UpdateSkillService, :skill, :name, :category ],
      [ :library_fact, LibraryFacts::UpdateLibraryFactService, :library_fact, :response, :requirement ]
    ].each do |factory, service, argument, changed, retained|
      record = create(factory, user: user, screened_fields: [ changed.to_s, retained.to_s ])
      result = service.call(**{ argument => record }, attributes: { changed => "New text" })
      expect(result).to be_success
      expect(record.reload.screened_fields).to eq([ retained.to_s ])
      service.call(**{ argument => record }, attributes: { changed => "New text" })
      expect(record.reload.screened_fields).to eq([ retained.to_s ])
    end
  end

  it "keeps approvals on unchanged text and ordering updates" do
    project = create(:project, user: user, screened_fields: %w[name description])
    Projects::UpdateProjectService.call(project: project, attributes: { name: project.name, position: 3 })
    expect(project.reload.screened_fields).to eq(%w[name description])
  end

  it "clears summary screening on profile edits and library clearing" do
    user.update!(summary: "Old", screened_fields: [ "summary" ])
    Users::UpdateProfileService.call(user: user, attributes: { summary: "New" })
    expect(user.reload.screened_fields).to eq([])
    user.update!(screened_fields: [ "summary" ])
    CareerLibrary::ClearCareerLibraryService.call(user: user)
    expect(user.reload.screened_fields).to eq([])
  end

  it "forgets blank fields filled during a merge but keeps the target name check" do
    target = create(:project, user: user, description: nil, screened_fields: %w[name description])
    source = create(:project, user: user, description: "Imported")
    expect(CareerLibrary::MergeLibraryRecordsService.call(target: target, source: source)).to be_success
    expect(target.reload.screened_fields).to eq([ "name" ])
  end

  it "makes replacement highlights unchecked" do
    experience = create(:experience, user: user)
    experience.highlights.create!(content: "Old", position: 0, screened_fields: [ "content" ])
    Experiences::UpdateExperienceService.call(experience: experience, attributes: {}, highlights: [ "New" ])
    expect(experience.reload.highlights.first.screened_fields).to eq([])
  end

  it "makes imported library entries unchecked and clears a newly filled summary check" do
    user.update!(summary: nil, screened_fields: [ "summary" ])
    task = create(:ai_task, :completed_resume_parse, user: user)
    parsed = { "summary" => "Imported summary", "projects" => [ { "name" => "New project" } ] }
    expect(ResumeImports::ImportParsedResumeService.call(ai_task: task, parsed_resume: parsed)).to be_success
    expect(user.reload.screened_fields).to eq([])
    expect(user.projects.sole.screened_fields).to eq([])
  end

  it "forgets an updated library response saved through a job gap" do
    fact = create(:library_fact, user: user, screened_fields: %w[requirement response])
    job = create(:job, user: user)
    result = GapResponses::SaveGapResponseService.call(job: job, requirement: fact.requirement,
                                                      body: "New response", add_to_library: true)
    expect(result).to be_success
    expect(fact.reload.screened_fields).to eq([ "requirement" ])
  end
end
