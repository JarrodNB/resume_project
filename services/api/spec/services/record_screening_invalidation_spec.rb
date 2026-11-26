# Checks screening reuse through library edits, merges, imports, and gap-answer saves.
require "rails_helper"

RSpec.describe "Career library screening state" do
  let(:user) { create(:user) }

  it "forgets only changed fields through the shared library save" do
    [
      [ :experience, :title, :company ],
      [ :project, :name, :description ],
      [ :education, :institution, :degree ],
      [ :certification, :name, :issuer ],
      [ :skill, :name, :category ],
      [ :career_context, :response, :requirement ]
    ].each do |kind, changed, retained|
      record = create(kind, user: user, screened_fields: [ changed.to_s, retained.to_s ])
      save = -> { CareerLibrary::SaveLibraryEntryService.call(user: user, kind: kind, entry: record, attributes: { changed => "New text" }) }
      expect(save.call).to be_success
      expect(record.reload.screened_fields).to eq([ retained.to_s ])
      save.call
      expect(record.reload.screened_fields).to eq([ retained.to_s ])
    end
  end

  it "keeps approvals on unchanged text and ordering updates" do
    project = create(:project, user: user, screened_fields: %w[name description])
    CareerLibrary::SaveLibraryEntryService.call(user: user, kind: :project, entry: project, attributes: { name: project.name, position: 3 })
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
    CareerLibrary::SaveLibraryEntryService.call(user: experience.user, kind: :experience, entry: experience, attributes: {}, highlights: [ "New" ])
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
    context = create(:career_context, user: user, screened_fields: %w[requirement response])
    job = create(:job, user: user)
    result = GapResponses::SaveGapResponseService.call(job: job, requirement: context.requirement,
                                                      body: "New response", add_to_library: true)
    expect(result).to be_success
    expect(context.reload.screened_fields).to eq([ "requirement" ])
  end
end
