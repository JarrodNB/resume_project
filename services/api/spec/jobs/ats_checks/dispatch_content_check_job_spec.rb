# Exhaust actual retry delivery and observe the shared task/report notification contract.
require "rails_helper"

RSpec.describe AtsChecks::DispatchContentCheckJob, type: :job do
  include ActiveJob::TestHelper
  let(:resume) { create(:resume) }
  let(:run) { AtsChecks::ScheduleContentCheckService.call(resume: resume).value }
  let(:queue) { double("SQS") }

  before do
    run
    allow(ActiveRecord).to receive(:after_all_transactions_commit).and_yield
    allow(ApiSchema.subscriptions).to receive(:trigger)
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(IOError.new("offline")))
  end

  it "fails the existing task after five attempts and informs both subscriptions" do
    perform_enqueued_jobs(only: described_class) { described_class.perform_later(run.id) }
    expect(queue).to have_received(:send_message).exactly(5).times
    task = run.reload.ai_task
    expect(task.status).to eq("failed")
    expect(task.completed_at).to be_present
    expect(run.status).to eq("failed")
    expect(run.error_message).to include("retry")
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: task.id }, task).once
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ats_report_updated, { resume_id: resume.id }, anything).at_least(:once)
    before_version = run.lock_version
    described_class.perform_now(run.id)
    expect(run.reload.lock_version).to eq(before_version)
    expect(resume.user.ai_tasks.count).to eq(1)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: task.id }, task).once
  end

  it "fails taskless pending work once without manufacturing an AI task" do
    AtsChecks::FailContentDispatchService.call(run: run)
    first_version = run.reload.lock_version
    AtsChecks::FailContentDispatchService.call(run: run)
    expect(run.reload.status).to eq("failed")
    expect(run.lock_version).to eq(first_version)
    expect(run.ai_task).to be_nil
    expect(ApiSchema.subscriptions).not_to have_received(:trigger).with(:ai_task_updated, anything, anything)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ats_report_updated, { resume_id: resume.id }, anything).once
  end

  it "retains known charges and makes duplicate exhaustion a no-op" do
    task = create(:ai_task, user: resume.user, subject: resume, task_type: "check_resume_content",
      status: "queued", input_tokens: 27, cost_microdollars: 63)
    run.update!(ai_task: task)
    2.times { AtsChecks::FailContentDispatchService.call(run: run) }
    expect(task.reload.status).to eq("failed")
    expect(task.input_tokens).to eq(27)
    expect(task.cost_microdollars).to eq(63)
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: task.id }, task).once
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ats_report_updated, { resume_id: resume.id }, anything).once
  end

  it "preserves a task which completed before retry exhaustion was handled" do
    task = create(:ai_task, user: resume.user, subject: resume, task_type: "check_resume_content", status: "completed")
    run.update!(ai_task: task, status: "completed", content_result: { "content_quality" => { "score" => 90 } })
    version = run.lock_version
    AtsChecks::FailContentDispatchService.call(run: run)
    expect(task.reload.status).to eq("completed")
    expect(run.reload.lock_version).to eq(version)
    expect(run.content_result.dig("content_quality", "score")).to eq(90)
    expect(ApiSchema.subscriptions).not_to have_received(:trigger)
  end
end
