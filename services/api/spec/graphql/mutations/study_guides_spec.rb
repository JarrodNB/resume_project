# Exercises owned study-guide generation and saved result retrieval through GraphQL.
require "rails_helper"

RSpec.describe "Study guide generation" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, description: "Maintain inventory records and reconcile stock counts.") }
  let(:mutation) { 'mutation($id: ID!) { generateStudyGuide(input: {jobId: $id}) { aiTask { id status } errors } }' }

  before { allow(Shoryuken::Client).to receive_message_chain(:queues, :send_message) }

  it "queues the exact description without requiring a career library" do
    data = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(data.dig("data", "generateStudyGuide", "errors")).to eq([])
    task = user.ai_tasks.last
    expect(task.task_type).to eq("generate_study_guide")
    expect(task.subject).to eq(job)
    expect(task.input).to eq("job_id" => job.id, "description" => job.description)
  end
  it "rejects another user's job" do
    response = execute_graphql(mutation, user: user, variables: { id: create(:job).id })
    expect(response["errors"].first["message"]).to eq("Record not found")
    expect(user.ai_tasks).to be_empty
  end

  it "rejects blank descriptions and overlapping generation" do
    job.update!(description: "  ")
    response = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(response.dig("data", "generateStudyGuide", "errors")).to include(/Add a job description/)
    job.update!(description: "Reconcile inventory.")
    2.times { execute_graphql(mutation, user: user, variables: { id: job.id }) }
    expect(user.ai_tasks.count).to eq(1)
  end

  it "manually retries an expired queued guide, preserving prior guides and late usage" do
    allow(ApiSchema.subscriptions).to receive(:trigger)
    saved = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed",
      result: { "study_guide" => { "title" => "Saved material" } }, created_at: 1.hour.ago)
    expired = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", created_at: (AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW + 1.minute).ago,
      input: { "job_id" => job.id, "description" => job.description }, cost_microdollars: 11)
    response = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(response.dig("data", "generateStudyGuide", "errors")).to eq([])
    new_id = response.dig("data", "generateStudyGuide", "aiTask", "id")
    expect(new_id).not_to eq(expired.id)
    expect(expired.reload).to be_failed
    expect(expired.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
    expect(expired.cost_microdollars).to eq(11)
    expect(saved.reload.result).to eq("study_guide" => { "title" => "Saved material" })
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: expired.id }, expired).once

    late_guide = { "version" => 1, "title" => "Late output", "questions" => Array.new(5) { |index|
      { "question" => "How do you reconcile inventory #{index + 1}?", "why_it_matters" => "The job reconciles stock.",
        "answer" => "Compare physical counts with stock records and investigate missing receipts.",
        "example" => "A count of 8 against a record of 10 leaves 2 to investigate before correction." }
    } }
    late = { "ai_task_id" => expired.id, "status" => "completed", "attempt_id" => SecureRandom.uuid,
      "usage" => [ { "cost_microdollars" => 7 } ], "result" => { "study_guide" => late_guide } }
    2.times { AiTasks::ApplyAiResultService.call(message: late) }
    expect(expired.reload).to be_failed
    expect(expired.result).to be_nil
    expect(expired.cost_microdollars).to eq(18)
    expect(user.ai_tasks.find(new_id)).to be_queued
    expect(job.reload.ai_tasks.completed.pluck(:id)).to eq([ saved.id ])
  end

  it "keeps recent work protected and exposes the shared window's remaining recovery time" do
    travel_to Time.current.change(usec: 0) do
      queued = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide",
        created_at: AiUsage::CheckAiTaskAllowanceService::IN_FLIGHT_WINDOW.ago + 10.seconds)
      read = execute_graphql('query($id: ID!) { job(id: $id) { latestStudyGuideTask { studyGuideRetryAfterSeconds } } }', user: user, variables: { id: job.id })
      expect(read.dig("data", "job", "latestStudyGuideTask", "studyGuideRetryAfterSeconds")).to eq(10.0)
      response = execute_graphql(mutation, user: user, variables: { id: job.id })
      expect(response.dig("data", "generateStudyGuide", "errors")).to include(/already being generated/)
      expect(queued.reload).to be_queued

      travel 11.seconds
      read = execute_graphql('query($id: ID!) { job(id: $id) { latestStudyGuideTask { studyGuideRetryAfterSeconds } } }', user: user, variables: { id: job.id })
      expect(read.dig("data", "job", "latestStudyGuideTask", "studyGuideRetryAfterSeconds")).to eq(0.0)
      expect(queued.reload).to be_queued
      expect(user.ai_tasks.count).to eq(1)
    end
  end

  it "does not retire expired work when allowance prevents a replacement" do
    queued = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", created_at: 1.hour.ago)
    allow(AiUsage::CheckAiTaskAllowanceService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Budget reached" ]))
    response = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(response.dig("data", "generateStudyGuide", "errors")).to eq([ "Budget reached" ])
    expect(queued.reload).to be_queued
    expect(user.ai_tasks.count).to eq(1)
  end

  it "keeps the successful guide readable after a newer attempt fails" do
    saved = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed", result: { study_guide: { title: "Inventory" } })
    failed = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "failed", created_at: 1.minute.from_now)
    response = execute_graphql('query($id: ID!) { job(id: $id) { latestStudyGuide { id result } latestStudyGuideTask { id status } } }', user: user, variables: { id: job.id })
    expect(response.dig("data", "job", "latestStudyGuide", "id")).to eq(saved.id)
    expect(response.dig("data", "job", "latestStudyGuideTask", "id")).to eq(failed.id)
  end

  it "respects AI allowances without creating or publishing work" do
    allow(AiUsage::CheckAiTaskAllowanceService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Budget reached" ]))
    response = execute_graphql(mutation, user: user, variables: { id: job.id })
    expect(response.dig("data", "generateStudyGuide", "errors")).to eq([ "Budget reached" ])
    expect(user.ai_tasks).to be_empty
  end

  it "hides a deleted job's guide source and result from direct task reads" do
    task = create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed", input: { description: job.description }, result: { study_guide: { title: "private" } })
    Records::DestroyRecordService.call(record: job)
    response = execute_graphql('query($id: ID!) { aiTask(id: $id) { input result } }', user: user, variables: { id: task.id })
    expect(response.dig("data", "aiTask")).to eq("input" => {}, "result" => nil)
    response = execute_graphql('query($id: ID!) { aiTask(id: $id) { result } }', user: create(:user), variables: { id: task.id })
    expect(response["errors"].first["message"]).to eq("Record not found")
  end

end
