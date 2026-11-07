# Old uploaded resume files are deleted; recent or unfinished uploads and the parsed results stay.
require "rails_helper"

RSpec.describe ResumeImports::PurgeOldUploadsService do
  def parse_task(status:, completed_at:)
    create(:ai_task, task_type: "parse_resume", status: status, completed_at: completed_at).tap do |task|
      task.source_file.attach(io: StringIO.new("%PDF-1.4"), filename: "resume.pdf", content_type: "application/pdf")
    end
  end

  it "purges uploads from parses that finished over 30 days ago and keeps the parsed result" do
    completed = parse_task(status: "completed", completed_at: 31.days.ago)
    completed.update!(result: { "parsed_resume" => { "skills" => [] } })
    failed = parse_task(status: "failed", completed_at: 40.days.ago)

    expect(described_class.call.value).to eq(2)
    expect(completed.reload.source_file).not_to be_attached
    expect(failed.reload.source_file).not_to be_attached
    expect(completed.result).to eq({ "parsed_resume" => { "skills" => [] } })
  end

  it "keeps recent and unfinished uploads" do
    recent = parse_task(status: "completed", completed_at: 29.days.ago)
    queued = parse_task(status: "queued", completed_at: nil)
    queued.update_columns(created_at: 60.days.ago)

    expect(described_class.call.value).to eq(0)
    expect(recent.reload.source_file).to be_attached
    expect(queued.reload.source_file).to be_attached
  end

  it "is safe to run twice" do
    parse_task(status: "completed", completed_at: 31.days.ago)
    described_class.call
    expect(described_class.call.value).to eq(0)
  end
end
