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

  it "creates the resume and its sections once" do
    result = described_class.call(ai_task: ai_task, sections: sections)

    expect(result).to be_success
    resume = result.value
    expect(resume.job).to eq(job)
    expect(resume.title).to eq("Backend Engineer at Northwind")
    expect(resume.sections.order(:position).map(&:section_type)).to eq(%w[contact summary])
    expect(ai_task.reload).to be_accepted
    expect(resume.ats_check_runs.count).to eq(1)
    expect(resume.ats_check_runs.first.status).to eq("pending")
  end

  it "keeps the resume when the job is deleted" do
    described_class.call(ai_task: ai_task, sections: sections)
    resume = user.resumes.first

    job.destroy!

    expect(resume.reload.job).to be_nil
    expect(resume.sections.count).to eq(2)
  end

  it "refuses a second save" do
    described_class.call(ai_task: ai_task, sections: sections)

    result = described_class.call(ai_task: ai_task, sections: sections)

    expect(result.errors).to eq([ described_class::ALREADY_SAVED_MESSAGE ])
    expect(user.resumes.count).to eq(1)
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
