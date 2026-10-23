# Approval callbacks and editors may hold different loaded copies of one record.
# Editing must invalidate the changed value's latest approval and retain unchanged checks.
require "rails_helper"

RSpec.describe "Interview approval and career edit interleaving" do
  let(:user) { create(:user, summary: "Profile evidence") }

  def approve_sources(interview, indices)
    operation = interview.operations.first
    claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    expect(claim).to be_success
    result = Interviews::RecordLibraryScreeningService.call(operation: operation,
      **claim.value.slice(:attempt_id, :claim_generation), source_indices: indices)
    expect(result).to be_success
  end

  [
    [ :experience, Experiences::UpdateExperienceService, :experience, :title, :company ],
    [ :project, Projects::UpdateProjectService, :project, :name, :description ],
    [ :education, Educations::UpdateEducationService, :education, :institution, :degree ],
    [ :certification, Certifications::UpdateCertificationService, :certification, :name, :issuer ],
    [ :skill, Skills::UpdateSkillService, :skill, :name, :category ],
    [ :library_fact, LibraryFacts::UpdateLibraryFactService, :library_fact, :response, :requirement ]
  ].each do |factory, service, argument, changed, retained|
    it "invalidates newly approved #{factory} text even when its editor loaded earlier" do
      record = create(factory, user: user, screened_fields: [ retained.to_s ])
      stale_editor_record = record.class.find(record.id)
      interview = Interviews::StartPreparationService.call(user: user).value
      indices = interview.frozen_context.fetch("sources").each_index.select do |index|
        source = interview.frozen_context.fetch("sources")[index]
        source["id"] == record.id && source["field"] == changed.to_s
      end
      expect(indices).not_to be_empty
      approve_sources(interview, indices)
      expect(record.reload.screened_fields).to include(changed.to_s)

      result = service.call(**{ argument => stale_editor_record }, attributes: { changed => "Edited after approval" })
      expect(result).to be_success
      expect(record.reload[changed]).to eq("Edited after approval")
      expect(record.screened_fields).to eq([ retained.to_s ])
      expect(interview.reload.frozen_context.fetch("sources")[indices.first]["screened"]).to be(true)
    end
  end

  it "invalidates a newly approved summary when an earlier profile editor saves" do
    stale_user = User.find(user.id)
    interview = Interviews::StartPreparationService.call(user: user).value
    approve_sources(interview, [ 0 ])
    expect(user.reload.screened_fields).to include("summary")
    expect(Users::UpdateProfileService.call(user: stale_user, attributes: { summary: "New summary" })).to be_success
    expect(user.reload.screened_fields).to be_empty
  end

  it "clears a summary approval earned after the clear request loaded its user" do
    stale_user = User.find(user.id)
    interview = Interviews::StartPreparationService.call(user: user).value
    approve_sources(interview, [ 0 ])
    expect(CareerLibrary::ClearCareerLibraryService.call(user: stale_user)).to be_success
    expect(user.reload.summary).to be_nil
    expect(user.screened_fields).to be_empty
  end

  it "does not import over a profile filled and approved after the import loaded it" do
    user.update!(summary: nil)
    task = create(:ai_task, :completed_resume_parse, user: user)
    importer = ResumeImports::ImportParsedResumeService.new(ai_task: AiTask.find(task.id), parsed_resume: { "summary" => "Imported replacement" })
    user.update!(summary: "Live profile evidence")
    interview = Interviews::StartPreparationService.call(user: user).value
    approve_sources(interview, [ 0 ])
    expect(importer.call).to be_success
    expect(user.reload.summary).to eq("Live profile evidence")
    expect(user.screened_fields).to include("summary")
  end

  it "does not merge over a target field filled and approved after the merge loaded it" do
    target = create(:project, user: user, description: nil)
    stale_target = Project.find(target.id)
    source = create(:project, user: user, description: "Imported description")
    target.update!(description: "Recently filled description")
    interview = Interviews::StartPreparationService.call(user: user).value
    index = interview.frozen_context.fetch("sources").index { |item| item["id"] == target.id && item["field"] == "description" }
    approve_sources(interview, [ index ])
    expect(CareerLibrary::MergeLibraryRecordsService.call(target: stale_target, source: source)).to be_success
    expect(target.reload.description).to eq("Recently filled description")
    expect(target.screened_fields).to include("description")
  end

  it "invalidates a fact approval earned between gap-response lookup and assignment" do
    fact = create(:library_fact, user: user)
    stale_fact = LibraryFact.find(fact.id)
    job = create(:job, user: user)
    interview = Interviews::StartPreparationService.call(user: user).value
    index = interview.frozen_context.fetch("sources").index { |item| item["id"] == fact.id && item["field"] == "response" }
    facts = job.user.library_facts
    allow(job.user).to receive(:library_facts).and_return(facts)
    allow(facts).to receive(:find_or_initialize_by).with(requirement: fact.requirement) do
      approve_sources(interview, [ index ])
      stale_fact
    end
    result = GapResponses::SaveGapResponseService.call(job: job, requirement: fact.requirement,
      body: "A new gap answer", add_to_library: true)
    expect(result).to be_success
    expect(fact.reload.response).to eq("A new gap answer")
    expect(fact.screened_fields).not_to include("response")
  end

  it "retains an unchanged field approval earned after the editor loaded" do
    project = create(:project, user: user, description: "Existing project evidence")
    stale_project = Project.find(project.id)
    interview = Interviews::StartPreparationService.call(user: user).value
    indices = interview.frozen_context.fetch("sources").each_index.select do |index|
      interview.frozen_context.fetch("sources")[index]["id"] == project.id
    end
    approve_sources(interview, indices)
    expect(Projects::UpdateProjectService.call(project: stale_project, attributes: { name: "New project name" })).to be_success
    expect(project.reload.screened_fields).to eq([ "description" ])
  end
end
