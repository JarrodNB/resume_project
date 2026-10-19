# Content edits clear checks through domain services, while unrelated state keeps them.
require "rails_helper"

RSpec.describe "Saved source screening invalidation" do
  let(:user) { create(:user) }

  def checked(record)
    record.update_columns(screened_at: Time.current, screening_policy_version: "policy-1")
    record
  end

  def expect_unchecked(record)
    expect(record.reload).to have_attributes(screened_at: nil, screening_policy_version: nil)
  end

  [ [ :job, Jobs::UpdateJobService, :job, { title: "New title" } ],
    [ :project, Projects::UpdateProjectService, :project, { description: "New description" } ],
    [ :education, Educations::UpdateEducationService, :education, { degree: "New degree" } ],
    [ :certification, Certifications::UpdateCertificationService, :certification, { issuer: "New issuer" } ],
    [ :skill, Skills::UpdateSkillService, :skill, { category: "New category" } ],
    [ :library_fact, LibraryFacts::UpdateLibraryFactService, :library_fact, { response: "New response" } ] ].each do |factory, service, key, attributes|
    it "clears #{factory} screening on a relevant edit but preserves unchanged saves" do
      record = checked(create(factory, user: user))
      unchanged = attributes.keys.index_with { |field| record.public_send(field) }
      expect(service.call(**{ key => record, attributes: unchanged })).to be_success
      expect(record.reload.screened_at).to be_present
      expect(service.call(**{ key => record, attributes: attributes })).to be_success
      expect_unchecked(record)
    end
  end

  it "clears a newly approved database row when an edit started from an unchecked instance" do
    record = create(:project, user: user)
    Project.where(id: record.id).update_all(screened_at: Time.current, screening_policy_version: "policy-1")
    Projects::UpdateProjectService.call(project: record, attributes: { description: "New content" })
    expect_unchecked(record)
  end

  it "keeps summary screening for contact edits and clears it for summary edits" do
    checked(user)
    Users::UpdateProfileService.call(user: user, attributes: { name: "New name" })
    expect(user.reload.screened_at).to be_present
    Users::UpdateProfileService.call(user: user, attributes: { summary: "New summary" })
    expect_unchecked(user)
  end

  it "preserves job stage changes and library ordering" do
    job = checked(create(:job, user: user))
    Jobs::MoveJobToStageService.call(job: job, stage: "applied")
    expect(job.reload.screened_at).to be_present
    skill = checked(create(:skill, user: user))
    CareerLibrary::ReorderLibraryEntriesService.call(records: user.skills, ordered_ids: [ skill.id ])
    expect(skill.reload.screened_at).to be_present
  end

  it "invalidates an experience and advances its version after child-only edits, even when initially unchecked" do
    role = create(:experience, user: user)
    create(:experience_highlight, experience: role, content: "Old bullet")
    original = role.reload.updated_at
    travel_to(1.second.from_now) do
      expect(Experiences::UpdateExperienceService.call(experience: role, attributes: {}, highlights: [ "New bullet" ])).to be_success
    end
    expect(role.reload.updated_at).to be > original
    expect_unchecked(role)
  end

  it "preserves screening when replacement only reorders unchanged highlights" do
    role = checked(create(:experience, user: user))
    create(:experience_highlight, experience: role, content: "First", position: 0)
    create(:experience_highlight, experience: role, content: "Second", position: 1)
    Experiences::UpdateExperienceService.call(experience: role, attributes: {}, highlights: [ "Second", "First" ])
    expect(role.reload.screened_at).to be_present
    expect(role.highlights.order(:position).pluck(:content)).to eq([ "Second", "First" ])
  end

  it "invalidates both roles on moves, but keeps approval on a reorder within a role" do
    source = checked(create(:experience, user: user))
    target = checked(create(:experience, user: user))
    highlight = create(:experience_highlight, experience: source)
    original = [ source.updated_at, target.updated_at ]
    Experiences::MoveHighlightService.call(highlight: highlight, experience: source, position: 0)
    expect(source.reload.screened_at).to be_present
    travel_to(1.second.from_now) do
      Experiences::MoveHighlightService.call(highlight: highlight.reload, experience: target, position: 0)
    end
    [ source, target ].each_with_index do |role, index|
      expect_unchecked(role)
      expect(role.updated_at).to be > original[index]
    end
  end

  it "invalidates merged child content and advances the parent version" do
    target = checked(create(:experience, user: user))
    source = create(:experience, user: user)
    create(:experience_highlight, experience: source, content: "Merged bullet")
    original = target.updated_at
    travel_to(1.second.from_now) do
      expect(CareerLibrary::MergeLibraryRecordsService.call(target: target, source: source)).to be_success
    end
    expect_unchecked(target)
    expect(target.updated_at).to be > original
  end

  it "clears gap answer and linked fact screening on edits, retaining untouched answers" do
    job = create(:job, user: user)
    result = GapResponses::SaveGapResponseService.call(job: job, requirement: "Ruby", body: "Old answer", add_to_library: true)
    response = checked(result.value)
    fact = checked(response.library_fact)
    GapResponses::SaveGapResponseService.call(job: job, requirement: "Ruby", body: "Old answer", add_to_library: true)
    expect(response.reload.screened_at).to be_present
    GapResponses::SaveGapResponseService.call(job: job, requirement: "Ruby", body: "New answer", add_to_library: true)
    expect_unchecked(response)
    expect_unchecked(fact)
  end

  it "clears question screening on answer edits, preserving unchanged saves" do
    question = InterviewQuestionSet.create!(user: user, number: 1).questions.create!(position: 1, question_text: "Tell me about your work", answer_text: "Old answer")
    checked(question)
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "Old answer")
    expect(question.reload.screened_at).to be_present
    InterviewPrep::SaveAnswerService.call(question: question, answer_text: "New answer")
    expect_unchecked(question)
  end
end
