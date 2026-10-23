# The completed Markdown draft and its source library are independent snapshots.
require "rails_helper"

RSpec.describe "Complete Markdown draft saving" do
  it "edits a saved resume without modifying career library or task history" do
    user = create(:user)
    job = create(:job, user: user)
    credential = create(:certification, user: user)
    task = create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", result: { "markdown" => "# Ada\n\n#{credential.name}", "target_pages" => 2 })
    resume = ResumeTailoring::SaveTailoredResumeService.call(ai_task: task).value
    result = ResumeTailoring::UpdateResumeService.call(resume: resume, markdown: "# Ada\n\nEdited credential")
    expect(result).to be_success
    expect(resume.reload.markdown).to eq("# Ada\n\nEdited credential")
    expect(credential.reload.name).to eq("AWS Solutions Architect")
    expect(task.reload.result["markdown"]).to include(credential.name)
    expect(resume.target_pages).to eq(2)
  end
end
