# Validates generated learning content at the queue result interface, including late deliveries.
require "rails_helper"

RSpec.describe "Study guide results" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, description: "Reconcile inventory.") }
  let(:task) { create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", input: { job_id: job.id, description: job.description }) }
  let(:guide) do
    { "title" => "Inventory study guide", "topics" => [ { "title" => "Stock reconciliation", "why_it_matters" => "The job requires reconciliation.", "explanation" => "Compare recorded stock with physical counts and investigate differences.", "exercises" => [ "Reconcile a sample stock ledger." ], "self_check_questions" => [ "What can cause a discrepancy?" ] } ] }
  end

  before { allow(ApiSchema.subscriptions).to receive(:trigger) }

  def apply(result)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => result })
  end

  it "fails invalid generated content rather than publishing a completed guide" do
    apply("study_guide" => { "title" => "Empty", "topics" => [] })
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
  end

  it "retains a valid guide and immutable source, ignoring duplicate result delivery" do
    apply("study_guide" => guide)
    apply("study_guide" => { "title" => "duplicate" })
    expect(task.reload).to be_completed
    expect(task.result).to eq("study_guide" => guide)
    expect(task.input["description"]).to eq("Reconcile inventory.")
    expect(ApiSchema.subscriptions).to have_received(:trigger).once
  end

  it "rejects a late completion after job deletion" do
    task
    job.destroy!
    apply("study_guide" => guide)
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
  end

  it "accepts a frozen-source guide as out of date when the description changes during generation" do
    task
    Jobs::UpdateJobService.call(job: job, attributes: { description: "Plan warehouse replenishment." })
    expect(job.ai_tasks.count).to eq(1)
    apply("study_guide" => guide)
    expect(task.reload).to be_completed
    expect(task.input["description"]).to eq("Reconcile inventory.")
    response = execute_graphql('query($id: ID!) { job(id: $id) { latestStudyGuide { id studyGuideOutOfDate result } } }', user: user, variables: { id: job.id })
    expect(response.dig("data", "job", "latestStudyGuide", "studyGuideOutOfDate")).to be(true)
    expect(response.dig("data", "job", "latestStudyGuide", "result")).to eq("study_guide" => guide)

    queue = double(send_message: true)
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    requested = StudyGuides::StartGuideService.call(user: user, job: job)
    expect(requested).to be_success
    expect(requested.value.input["description"]).to eq("Plan warehouse replenishment.")
    expect(job.ai_tasks.count).to eq(2)
    expect(task.reload.result).to eq("study_guide" => guide)
  end
end
