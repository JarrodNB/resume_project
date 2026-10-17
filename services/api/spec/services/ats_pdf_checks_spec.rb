# Check the owned exported-file boundary and independent PDF lifecycle.
require "rails_helper"
RSpec.describe "ATS PDF checks" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:resume) { user.resumes.create!(job: job, title: "Developer") }
  let!(:section) { resume.sections.create!(section_type: "summary", title: "Summary", position: 0, content: { text: "Ruby developer" }) }
  let(:run) { AtsChecks::ScheduleContentCheckService.call(resume: resume).value }
  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
    allow(ApiSchema.subscriptions).to receive(:trigger)
  end
  def submit(**overrides)
    file = StringIO.new("%PDF-1.4\nsynthetic")
    AtsChecks::StartPdfCheckService.call(resume: resume, run_id: run.id,
      content_fingerprint: run.content_fingerprint, renderer_version: "resume-pdf-v1", file: file, **overrides)
  end
  it "binds uploaded bytes to the exact saved run independently of content work" do
    expect(submit).to be_success
    state = run.reload.pdf_result
    expect(state["status"]).to eq("queued")
    task = user.ai_tasks.find(state["task_id"])
    expect(task.source_file).to be_attached
    expect(task.input["digest"]).to eq(Digest::SHA256.hexdigest("%PDF-1.4\nsynthetic"))
    expect(run.ai_task_id).to be_nil
    expect(task.input).not_to have_key("expected_text")
  end

  it "rejects saved edits and old run submissions without storing a file" do
    original = run
    section.update!(content: { text: "Changed" })
    expect(submit).not_to be_success
    expect(user.ai_tasks.count).to eq(0)
    expect(ActiveStorage::Blob.count).to eq(0)
  end
  it "deduplicates identical concurrent exports and notifies through the report" do
    submit
    first = run.reload.pdf_result
    submit
    expect(run.reload.pdf_result).to eq(first)
    expect(user.ai_tasks.count).to eq(1)
    expect(ApiSchema.subscriptions).to have_received(:trigger).at_least(:once)
  end
  it "applies validated PDF findings independently and removes its file" do
    submit
    task = user.ai_tasks.find(run.reload.pdf_result["task_id"])
    result = task.input.except("source_file").merge("checks" => %w[text_extraction coverage reading_order characters boundaries].map do |key|
      { "key" => key, "ratio" => 1.0, "evidence" => [ { "page" => 1, "excerpt" => "Ruby developer" } ],
        "explanation" => "Extracted correctly.", "suggested_action" => "", "severity" => "info" }
    end)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => result })
    expect(task.reload).to be_completed
    expect(run.reload.pdf_result["score"]).to eq(100)
    expect(run.status).to eq("pending")
    expect(task.source_file).not_to be_attached
  end

  it "preserves content outcomes on PDF failure and purges terminal files" do
    submit
    task = user.ai_tasks.find(run.reload.pdf_result["task_id"])
    run.update!(content_result: { "content_quality" => { "status" => "completed", "score" => 80 } })
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "failed", "error_message" => "Corrupt PDF" })
    expect(run.reload.pdf_result["status"]).to eq("failed")
    expect(run.content_result["content_quality"]["score"]).to eq(80)
    expect(task.reload.source_file).not_to be_attached
    expect(AtsChecks::ReadReportService.call(resume: resume).value[:overall_score]).to be_nil
  end
  it "never lets a late result replace a newer export" do
    submit
    old = user.ai_tasks.find(run.reload.pdf_result["task_id"])
    run.update!(pdf_result: run.pdf_result.merge("status" => "failed"))
    submit
    current = run.reload.pdf_result
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => old.id, "status" => "completed", "result" => {} })
    expect(run.reload.pdf_result).to eq(current)
    expect(old.reload.source_file).not_to be_attached
  end
  it "rejects invalid findings and cleans the temporary file" do
    submit
    task = user.ai_tasks.find(run.reload.pdf_result["task_id"])
    result = task.input.except("source_file").merge("checks" => [])
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => result })
    expect(task.reload).to be_failed
    expect(run.reload.pdf_result["status"]).to eq("failed")
    expect(task.source_file).not_to be_attached
  end
  it "honors allowance before storing bytes and handles queue failure cleanup" do
    user.update!(ai_tasks_per_hour_limit: 0)
    expect(submit).not_to be_success
    expect(ActiveStorage::Blob.count).to eq(0)
    user.update!(ai_tasks_per_hour_limit: 100)
    queue = double
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(IOError.new("offline")))
    expect(submit).not_to be_success
    expect(run.reload.pdf_result["status"]).to eq("failed")
    expect(ActiveStorage::Blob.count).to eq(0)
  end
  it "expires abandoned work and purges files without touching content" do
    submit
    task = user.ai_tasks.find(run.reload.pdf_result["task_id"])
    AtsChecks::CleanupPdfCheckJob.perform_now(task.id)
    expect(task.reload).to be_failed
    expect(task.source_file).not_to be_attached
    expect(run.reload.pdf_result["status"]).to eq("failed")
    expect(run.status).to eq("pending")
  end

  it "marks an obsolete renderer result outdated" do
    submit
    run.update!(pdf_result: run.reload.pdf_result.merge("status" => "completed", "score" => 100, "renderer_version" => "older"))
    expect(AtsChecks::ReadReportService.call(resume: resume).value[:pdf_readability]["status"]).to eq("outdated")
  end

  it "keeps the remaining category mean current after job deletion" do
    submit
    run.update!(content_result: { "job_alignment" => { "status" => "completed", "score" => 60 }, "content_quality" => { "status" => "completed", "score" => 80 } },
      pdf_result: run.reload.pdf_result.merge("status" => "completed", "score" => 100))
    job.destroy!
    report = AtsChecks::ReadReportService.call(resume: resume).value
    expect(report[:job_alignment]["status"]).to eq("unavailable")
    expect(report[:outdated]).to be(false)
    expect(report[:overall_score]).to eq(90)
  end
end
