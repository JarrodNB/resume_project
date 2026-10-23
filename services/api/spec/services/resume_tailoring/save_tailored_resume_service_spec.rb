# Saving a completed Markdown task accepts it once and preserves the user's source records.
require "rails_helper"

RSpec.describe ResumeTailoring::SaveTailoredResumeService do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, title: "Backend Engineer", company: "Northwind") }
  let(:task) { create(:ai_task, user: user, subject: job, task_type: "tailor_resume", status: "completed", result: { "markdown" => "# Ada\n\nOriginal", "target_pages" => 1 }) }

  it "saves the submitted edit and requested page count without changing the task snapshot" do
    result = described_class.call(ai_task: task, markdown: "# Ada\n\nRevised")
    expect(result).to be_success
    expect(result.value.attributes.slice("title", "markdown", "target_pages")).to eq("title" => "Backend Engineer at Northwind", "markdown" => "# Ada\n\nRevised", "target_pages" => 1)
    expect(task.reload.result["markdown"]).to eq("# Ada\n\nOriginal")
    expect(task).to be_accepted
  end

  it "rejects a blank or overlong edit without accepting the task" do
    [" ", "a" * (Resume::MAX_MARKDOWN_LENGTH + 1)].each do |markdown|
      expect(described_class.call(ai_task: task, markdown: markdown)).not_to be_success
      expect(task.reload).not_to be_accepted
      expect(user.resumes.count).to eq(0)
    end
  end

  it "rejects invalid page targets and legacy section results" do
    task.update!(result: { "markdown" => "# Ada", "target_pages" => 3 })
    expect(described_class.call(ai_task: task)).not_to be_success
    task.update!(result: { "sections" => [] })
    expect(described_class.call(ai_task: task, markdown: "# Ada")).not_to be_success
    expect(task.reload).not_to be_accepted
  end

  it "cannot be saved again even if its saved resume was deleted" do
    resume = described_class.call(ai_task: task).value
    Records::DestroyRecordService.call(record: resume)
    expect(described_class.call(ai_task: task.reload).errors).to eq([described_class::ALREADY_SAVED_MESSAGE])
    expect(user.resumes.count).to eq(0)
  end

  it "keeps the resume after job deletion" do
    resume = described_class.call(ai_task: task).value
    job.destroy!
    expect(resume.reload.job).to be_nil
    expect(resume.markdown).to eq("# Ada\n\nOriginal")
  end
end
