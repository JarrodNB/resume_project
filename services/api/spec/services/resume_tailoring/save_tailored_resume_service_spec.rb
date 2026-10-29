# Description: Saving a finished tailoring draft creates the resume once.
require "rails_helper"

RSpec.describe ResumeTailoring::SaveTailoredResumeService do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, title: "Backend Engineer", company: "Northwind") }
  let(:sections) do
    [
      { "section_type" => "contact", "title" => "Contact", "content" => { "full_name" => "Ada" } },
      { "section_type" => "summary", "title" => "Summary", "content" => { "text" => "Backend engineer." } }
    ]
  end
  let(:ai_task) do
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", result: { "sections" => sections })
  end

  it "retains summary text while excluding it, independently of later library defaults" do
    ai_task.update!(input: { "include_summary" => false })
    result = described_class.call(ai_task: ai_task, sections: sections)
    expect(result).to be_success
    expect(result.value.include_summary).to be(false)
    expect(result.value.sections.find_by!(section_type: "summary").content).to eq("text" => "Backend engineer.")
    Users::UpdateProfileService.call(user: user, attributes: { include_summary: true })
    expect(result.value.reload.include_summary).to be(false)
  end

  it "allows overriding the snapshotted default on first save" do
    ai_task.update!(input: { "include_summary" => false })
    expect(described_class.call(ai_task: ai_task, sections: sections, include_summary: true).value.include_summary).to be(true)
  end

  it "creates the resume and its sections once" do
    result = described_class.call(ai_task: ai_task, sections: sections)

    expect(result).to be_success
    resume = result.value
    expect(resume.job).to eq(job)
    expect(resume.title).to eq("Backend Engineer at Northwind")
    expect(resume.sections.order(:position).map(&:section_type)).to eq(%w[contact summary])
    expect(ai_task.reload).to be_accepted
  end

  it "rejects an explicit empty selection without saving the original draft" do
    ai_task

    result = described_class.call(ai_task: ai_task, sections: [])

    expect(result.errors).to eq([ described_class::NOT_READY_MESSAGE ])
    expect(user.resumes).to be_empty
    expect(ai_task.reload).not_to be_accepted
  end

  it "uses the original draft only when no selection was supplied" do
    result = described_class.call(ai_task: ai_task)

    expect(result).to be_success
    expect(result.value.sections.order(:position).map(&:content)).to eq(sections.map { |section| section["content"] })
  end

  it "saves only selected sections with current edits in the submitted order" do
    sections << { "section_type" => "skills", "content" => { "items" => [ { "name" => "Ruby" } ] } }
    chosen = [ sections[1].merge("content" => { "text" => "My revised summary." }), sections[0] ]

    result = described_class.call(ai_task: ai_task, sections: chosen)

    expect(result).to be_success
    expect(result.value.sections.order(:position).map { |section| [ section.section_type, section.position, section.content ] })
      .to eq([ [ "summary", 0, { "text" => "My revised summary." } ], [ "contact", 1, { "full_name" => "Ada" } ] ])
    expect(ai_task.reload.result["sections"]).to eq(sections)
  end

  it "keeps the resume when the job is deleted" do
    described_class.call(ai_task: ai_task, sections: sections)
    resume = user.resumes.first

    job.destroy!

    expect(resume.reload.job).to be_nil
    expect(resume.sections.count).to eq(2)
  end

  it "names a resume when the employer is unknown" do
    job.update!(company: nil)
    result = described_class.call(ai_task: ai_task, sections: sections)
    expect(result).to be_success
    expect(result.value.title).to eq("Backend Engineer at Unknown company")
  end

  it "refuses a second save" do
    described_class.call(ai_task: ai_task, sections: sections)

    result = described_class.call(ai_task: ai_task, sections: sections)

    expect(result.errors).to eq([ described_class::ALREADY_SAVED_MESSAGE ])
    expect(user.resumes.count).to eq(1)
  end

  it "never saves an accepted task again after its resume was deleted" do
    resume = described_class.call(ai_task: ai_task).value
    accepted_at = ai_task.reload.accepted_at
    Records::DestroyRecordService.call(record: resume)

    result = described_class.call(ai_task: ai_task.reload)

    expect(result.errors).to eq([ described_class::ALREADY_SAVED_MESSAGE ])
    expect(user.resumes).to be_empty
    expect(ai_task.reload.accepted_at).to eq(accepted_at)
  end

  it "rejects another completed draft when the job already has a saved resume" do
    create(:resume, user: user, job: job)

    result = described_class.call(ai_task: ai_task)

    expect(result.errors).to eq([ described_class::ALREADY_SAVED_MESSAGE ])
    expect(user.resumes.count).to eq(1)
    expect(ai_task.reload).not_to be_accepted
  end

  it "refuses a draft that is not finished" do
    ai_task.update!(status: "needs_user_input")

    result = described_class.call(ai_task: ai_task, sections: sections)

    expect(result.errors).to eq([ described_class::NOT_READY_MESSAGE ])
    expect(user.resumes).to be_empty
  end
  it "saves and edits a separate certification snapshot while preserving the library" do
    credential = create(:certification, user: user)
    sections << { "section_type" => "certifications", "title" => "Certifications", "content" => { "items" => [ { "name" => credential.name, "issuer" => credential.issuer } ] } }
    resume = described_class.call(ai_task: ai_task, sections: sections).value
    section = resume.sections.find_by!(section_type: "certifications")
    result = ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: [ { "id" => section.id, "content" => { "items" => [ { "name" => "Edited credential" } ] } } ])
    expect(result).to be_success
    expect(section.reload.content["items"].sole["name"]).to eq("Edited credential")
    expect(credential.reload.name).to eq("AWS Solutions Architect")
  end
end
