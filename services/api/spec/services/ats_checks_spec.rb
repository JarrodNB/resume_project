# Exercise saved-input scheduling and validated result application through public services.
require "rails_helper"
RSpec.describe "ATS content checks" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, requirements: ["Ruby"], nice_to_haves: ["Rails"]) }
  let(:resume) { user.resumes.create!(job: job, title: "Developer") }
  let!(:section) { resume.sections.create!(section_type: "summary", title: "Summary", position: 0, content: { text: "Ruby developer" }) }
  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: true))
    allow(ApiSchema.subscriptions).to receive(:trigger)
  end
  it "persists one immutable pending run for matching saved inputs" do
    first = AtsChecks::ScheduleContentCheckService.call(resume: resume).value
    second = AtsChecks::ScheduleContentCheckService.call(resume: resume).value
    expect(second.id).to eq(first.id)
    expect(first.status).to eq("pending")
    expect(first.content_snapshot.first["content"]).to eq("text" => "Ruby developer")
    expect(AtsCheckRun.count).to eq(1)
    expect(user.ai_tasks.count).to eq(0)
  end

  def schedule
    AtsChecks::ScheduleContentCheckService.call(resume: resume).value
  end

  def dispatch(run)
    AtsChecks::DispatchContentCheckService.call(run: run)
    run.reload
  end

  def result_for(run)
    { "run_id" => run.id, "content_fingerprint" => run.content_fingerprint,
      "job_fingerprint" => run.job_fingerprint, "rubric_version" => run.rubric_version,
      "requirements" => run.job_snapshot["requirements"].map do |r|
        { "requirement_id" => r["id"], "status" => r["required"] ? "covered" : "missing",
          "evidence" => r["required"] ? [{ "section_id" => section.id, "excerpt" => "Ruby" }] : [],
          "severity" => "warning", "explanation" => "Compared with saved evidence.", "suggested_action" => "Use only experience you can support." }
      end,
      "checks" => AtsChecks::Snapshot::CHECK_KEYS.map do |key|
        { "key" => key, "status" => "partial", "evidence" => [{ "section_id" => section.id, "excerpt" => "Ruby" }],
          "severity" => "warning", "explanation" => "Needs clearer supporting context.", "suggested_action" => "Clarify existing evidence." }
      end }
  end

  def apply(run, result = result_for(run))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => run.ai_task_id, "status" => "completed",
                                                "result" => result, "usage" => [{ "cost_microdollars" => 3 }] })
  end

  it "retries publication using the same queued task after a transient failure" do
    run = schedule
    queue = double
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(IOError.new("offline")))
    expect { dispatch(run) }.to raise_error(Seahorse::Client::NetworkingError)
    task_id = run.reload.ai_task_id
    expect(task_id).to be_present
    allow(queue).to receive(:send_message).and_return(true)
    dispatch(run)
    expect(run.ai_task_id).to eq(task_id)
    expect(run.status).to eq("queued")
    expect(user.ai_tasks.count).to eq(1)
  end

  it "reports allowance failure independently and does not retry unchanged input" do
    user.update!(ai_tasks_per_hour_limit: 0)
    run = schedule
    expect(AtsChecks::DispatchContentCheckService.call(run: run)).not_to be_success
    expect(run.reload.status).to eq("failed")
    expect(schedule.id).to eq(run.id)
    expect(AtsChecks::ScheduleContentCheckService.call(resume: resume, force: true).value.id).not_to eq(run.id)
  end

  it "computes weighted scores and leaves overall pending for export" do
    run = dispatch(schedule)
    expect(apply(run)).to be_success
    report = AtsChecks::ReadReportService.call(resume: resume).value
    expect(report[:job_alignment]["score"]).to eq(67)
    expect(report[:content_quality]["score"]).to eq(50)
    expect(report[:overall_score]).to be_nil
    expect(report[:pdf_readability]["status"]).to eq("awaiting_export")
    apply(run)
    expect(run.ai_task.reload.cost_microdollars).to eq(3)
  end

  it "rejects fabricated evidence and identity mismatches atomically" do
    run = dispatch(schedule)
    result = result_for(run)
    result["checks"][0]["evidence"][0]["excerpt"] = "invented qualification"
    apply(run, result)
    expect(run.ai_task.reload.status).to eq("failed")
    expect(run.reload.content_result).to eq({})
    expect(run.status).to eq("failed")
  end

  it "retains old snapshots while late results cannot replace newer input" do
    old = dispatch(schedule)
    section.update!(content: { text: "Ruby developer with Rails" })
    current = schedule
    apply(old)
    report = AtsChecks::ReadReportService.call(resume: resume).value
    expect(report[:run_id]).to eq(current.id)
    expect(report[:content_quality]["score"]).to be_nil
    expect(old.reload.content_snapshot[0]["content"]["text"]).to eq("Ruby developer")
    expect(old.content_result["content_quality"]["score"]).to eq(50)
  end

  it "invalidates alignment after requirement edits and omits it after job deletion" do
    run = dispatch(schedule)
    apply(run)
    job.update!(requirements: ["Python"])
    report = AtsChecks::ReadReportService.call(resume: resume).value
    expect(report[:job_alignment]["status"]).to eq("outdated")
    expect(report[:content_quality]["status"]).to eq("completed")
    job.destroy!
    report = AtsChecks::ReadReportService.call(resume: resume.reload).value
    expect(report[:job_alignment]["status"]).to eq("unavailable")
    expect(report[:overall_score]).to be_nil
  end

  it "schedules changed saves but ignores unchanged and failed saves" do
    payload = [{ "id" => section.id, "content" => { "text" => "Changed Ruby" } }]
    expect(ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: payload)).to be_success
    expect(AtsCheckRun.count).to eq(1)
    expect(ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: payload)).to be_success
    expect(AtsCheckRun.count).to eq(1)
    bad = [{ "id" => section.id, "content" => { "text" => "x" * (TextLimits::SCREENED_TEXT + 1) } }]
    expect(ResumeTailoring::UpdateResumeSectionsService.call(resume: resume, sections: bad)).not_to be_success
    expect(AtsCheckRun.count).to eq(1)
  end

  it "checks ownership for report reads and reruns" do
    schedule
    query = "query($id: ID!) { resume(id: $id) { atsReport { runId contentQuality { status } } } }"
    own = execute_graphql(query, user: user, variables: { id: resume.id })
    expect(own.dig("data", "resume", "atsReport", "runId")).to be_present
    other = create(:user)
    expect(execute_graphql(query, user: other, variables: { id: resume.id })["errors"][0]["message"]).to eq("Record not found")
    mutation = "mutation($id: ID!) { rerunResumeAtsCheck(input: {resumeId: $id}) { report { runId } errors } }"
    expect(execute_graphql(mutation, user: other, variables: { id: resume.id })["errors"][0]["message"]).to eq("Record not found")
    expect(execute_graphql(mutation, user: user, variables: { id: resume.id }).dig("data", "rerunResumeAtsCheck", "errors")).to eq([])
  end

  it "rejects nonterminal user-input results for this automatic check" do
    run = dispatch(schedule)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => run.ai_task_id,
                                                "status" => "needs_user_input", "pending_questions" => [] })
    expect(run.ai_task.reload.status).to eq("failed")
    expect(run.reload.status).to eq("failed")
  end

  it "preserves save success when background enqueue is unavailable" do
    allow(ActiveRecord).to receive(:after_all_transactions_commit).and_yield
    allow(AtsChecks::DispatchContentCheckJob).to receive(:perform_later).and_raise(IOError, "offline")
    result = ResumeTailoring::UpdateResumeSectionsService.call(resume: resume,
      sections: [{ "id" => section.id, "content" => { "text" => "Saved despite unavailable queue" } }])
    expect(result).to be_success
    expect(section.reload.content["text"]).to eq("Saved despite unavailable queue")
    expect(AtsCheckRun.last.status).to eq("pending")
  end

  it "makes interrupted scheduling visible and manual rerun redelivers pending work" do
    allow(ActiveRecord).to receive(:after_all_transactions_commit).and_yield
    allow(AtsChecks::DispatchContentCheckJob).to receive(:perform_later).and_raise(IOError, "offline")
    run = schedule
    expect(run.reload.error_message).to include("retry")
    failed = AtsChecks::ReadReportService.call(resume: resume).value
    expect(failed[:content_quality]["status"]).to eq("failed")
    failed_version = failed[:state_version].to_i
    allow(AtsChecks::DispatchContentCheckJob).to receive(:perform_later).and_return(true)
    retry_result = AtsChecks::ScheduleContentCheckService.call(resume: resume, force: true)
    expect(retry_result.value.id).to eq(run.id)
    recovered = AtsChecks::ReadReportService.call(resume: resume).value
    expect(recovered[:content_quality]["status"]).to eq("queued")
    expect(recovered[:content_quality]["reason"]).to be_nil
    expect(recovered[:state_version].to_i).to be > failed_version
    expect(AtsChecks::DispatchContentCheckJob).to have_received(:perform_later).with(run.id).twice
  end

  it "publishes report transitions after dispatch and result application" do
    allow(ActiveRecord).to receive(:after_all_transactions_commit).and_yield
    run = dispatch(schedule)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ats_report_updated, { resume_id: resume.id }, anything)
    apply(run)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ats_report_updated, { resume_id: resume.id }, anything).twice
    subscription = "subscription($id: ID!) { atsReportUpdated(resumeId: $id) { runId } }"
    other = create(:user)
    expect(execute_graphql(subscription, user: other, variables: { id: resume.id })["errors"][0]["message"]).to eq("Record not found")
  end

  it "orders persisted changes even when the clock does not advance" do
    travel_to(Time.utc(2026, 10, 17, 10, 0, 0)) do
      run = schedule
      before = AtsChecks::ReadReportService.call(resume: resume).value
      run.update!(error_message: "Retrying dispatch")
      after = AtsChecks::ReadReportService.call(resume: resume).value
      expect(after[:state_version].to_i).to be > before[:state_version].to_i
      expect(after[:observed_at]).to eq(before[:observed_at])
      expect(after[:created_at]).to end_with(".000000Z")
      job.update!(requirements: ["Changed requirement"])
      changed = AtsChecks::ReadReportService.call(resume: resume).value
      expect(changed[:state_version]).to eq(after[:state_version])
      expect(changed[:job_alignment]["status"]).to eq("outdated")
    end
  end
end
