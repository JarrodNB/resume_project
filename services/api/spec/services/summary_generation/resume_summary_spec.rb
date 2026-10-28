# Saved-resume summaries use their own evidence and preserve independent output choices.
require "rails_helper"

RSpec.describe "Missing saved-resume summary generation" do
  let(:user) { create(:user, summary: "Keep the library summary.") }
  let(:resume) { create(:resume, user: user, include_summary: false) }
  let!(:contact) { create(:resume_section, resume: resume, section_type: "contact", position: 0, content: { "full_name" => "Private contact" }) }
  let!(:experience) { create(:resume_section, resume: resume, section_type: "experience", position: 1, content: { "items" => [{ "title" => "Engineer", "company" => "Acme", "highlights" => ["Built billing APIs."] }] }) }
  before { allow(Shoryuken::Client).to receive(:queues).and_return(double("queue", send_message: nil)) }

  def start
    SummaryGeneration::StartGenerationService.call(user: user, target_kind: "resume", target_id: resume.id)
  end

  def complete(task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed",
      "result" => { "text" => "Engineer who built billing APIs.", "source_labels" => [task.input["sources"].first["label"]] } })
  end

  it "freezes only saved career evidence even after the job is deleted" do
    resume.job.destroy!
    result = start
    expect(result).to be_success
    task = result.value
    expect(task.input["target_id"]).to eq(resume.id)
    expect(task.input["sources"].map { |source| source["text"] }).to include("Built billing APIs.")
    expect(task.input["sources"].map { |source| source["text"] }).not_to include("Private contact", "Keep the library summary.")
    expect(start.value.id).to eq(task.id)
  end

  it "accepts once into an ordered section while preserving inclusion and the library" do
    task = start.value
    complete(task)
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).to be_success
    expect(resume.reload.include_summary).to be(false)
    expect(resume.sections.order(:position).pluck(:section_type)).to eq(%w[contact summary experience])
    expect(resume.sections.summary.sole.content).to eq("text" => "Engineer who built billing APIs.")
    expect(user.reload.summary).to eq("Keep the library summary.")
    ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: [{"id" => resume.sections.summary.sole.id, "content" => {"text" => "Later edit"}}])
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).to be_success
    expect(resume.sections.summary.sole.content["text"]).to eq("Later edit")
  end
  it "reuses a blank summary section and ignores inclusion-only changes" do
    blank = create(:resume_section, resume: resume, section_type: "summary", position: 4, content: {"text" => "  "})
    task = start.value
    complete(task)
    ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: [], include_summary: true)
    expect(SummaryGeneration::Snapshot.stale?(user: user, task: task)).to be(false)
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id, text: "Reviewed summary")).to be_success
    expect(resume.sections.summary.count).to eq(1)
    expect(blank.reload.content).to eq("text" => "Reviewed summary")
    expect(resume.reload.include_summary).to be(true)
  end

  it "refuses changed evidence, competing manual summaries, and deleted targets" do
    task = start.value
    complete(task)
    experience.update!(content: {"items" => [{"title" => "New role"}]})
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: task.id)).not_to be_success
    newer = start.value
    complete(newer)
    create(:resume_section, resume: resume, section_type: "summary", content: {"text" => "Manual summary"})
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: newer.id)).not_to be_success
    Records::DestroyRecordService.call(record: resume)
    expect(SummaryGeneration::FinishGenerationService.call(user: user, ai_task_id: newer.id).errors).to eq(["Record not found"])
    expect(SummaryGeneration::ReadStateService.call(user: user, target_kind: "resume", target_id: resume.id).errors).to eq(["Record not found"])
  end

  it "rejects empty and foreign evidence without falling back to the library" do
    empty = create(:resume, user: user)
    other = create(:resume)
    expect(SummaryGeneration::StartGenerationService.call(user: user, target_kind: "resume", target_id: empty.id)).not_to be_success
    expect(SummaryGeneration::StartGenerationService.call(user: user, target_kind: "resume", target_id: other.id).errors).to eq(["Record not found"])
    expect(SummaryGeneration::ReadStateService.call(user: user, target_kind: "resume", target_id: other.id).errors).to eq(["Record not found"])
  end

  it "trusts only exact generated prose in owned accepted tailoring results" do
    project = create(:resume_section, resume: resume, section_type: "projects", position: 2,
      content: {"items" => [{"name" => "Billing", "description" => "Built a billing dashboard."}]})
    education = create(:resume_section, resume: resume, section_type: "education", position: 3,
      content: {"items" => [{"institution" => "College", "description" => "Copied user description."}]})
    create(:ai_task, user: user, task_type: "tailor_resume", status: "completed", accepted_at: Time.current,
      result: {"sections" => [experience, project, education].map { |section| {"section_type" => section.section_type, "content" => section.content} }})
    sources = start.value.input["sources"]
    expect(sources.select { |source| source["screened"] }.map { |source| source["text"] }).to match_array(["Built billing APIs.", "Built a billing dashboard."])
    expect(sources.find { |source| source["text"] == "Copied user description." }["screened"]).to be(false)
    experience.update!(content: {"items" => [{"highlights" => ["Manual replacement"]}]})
    create(:ai_task, task_type: "tailor_resume", status: "completed", accepted_at: Time.current,
      result: {"sections" => [{"section_type" => "experience", "content" => experience.content}]})
    create(:ai_task, user: user, task_type: "tailor_resume", status: "completed",
      result: {"sections" => [{"section_type" => "experience", "content" => experience.content}]})
    expect(start.value.input["sources"].find { |source| source["text"] == "Manual replacement" }["screened"]).to be(false)
  end

end
