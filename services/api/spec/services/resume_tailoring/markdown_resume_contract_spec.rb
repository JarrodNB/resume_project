# A completed Markdown draft saves once, and later edits change only its document.
require "rails_helper"

RSpec.describe "Markdown resume contract" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:task) do
    create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed",
           result: { "markdown" => "# Ada\n\n## Experience\n- Built an API", "target_pages" => 1 })
  end

  it "saves edited Markdown once and updates the saved document" do
    result = ResumeTailoring::SaveTailoredResumeService.call(ai_task: task, markdown: "# Ada\n\nRevised")
    expect(result).to be_success
    expect(result.value.attributes.slice("markdown", "target_pages")).to eq("markdown" => "# Ada\n\nRevised", "target_pages" => 1)
    expect(task.reload).to be_accepted
    expect(ResumeTailoring::SaveTailoredResumeService.call(ai_task: task).errors).to eq(["This resume has already been saved."])
    expect(ResumeTailoring::UpdateResumeService.call(resume: result.value, markdown: "# New version")).to be_success
    expect(result.value.reload.markdown).to eq("# New version")
  end

  it "rejects a legacy section draft and does not accept it" do
    task.update!(result: { "sections" => [{ "section_type" => "summary", "content" => { "text" => "Old" } }] })
    expect(ResumeTailoring::SaveTailoredResumeService.call(ai_task: task, markdown: "# New")).not_to be_success
    expect(task.reload).not_to be_accepted
    expect(user.resumes.count).to eq(0)
  end
end
