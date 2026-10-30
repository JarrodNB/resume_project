# Validates generated learning content at the queue result interface, including late deliveries.
require "rails_helper"

RSpec.describe "Study guide results" do
  let(:user) { create(:user) }
  let(:job) { create(:job, user: user, description: "Reconcile inventory.") }
  let(:task) { create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", input: { job_id: job.id, description: job.description }) }
  let(:guide) do
    { "version" => 1, "title" => "Inventory study guide", "questions" => Array.new(5) { |index|
      { "question" => "How do you reconcile stock #{index + 1}?", "why_it_matters" => "The job requires reconciliation.",
        "answer" => "Compare recorded stock with physical counts and investigate differences.",
        "example" => "A count of 8 and a ledger of 10 differ by 2. Check receipts before correcting the ledger." }
    } }
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

  [ 4, 6 ].each do |count|
    it "rejects a batch of #{count} questions" do
      guide["questions"] = Array.new(count) { guide["questions"].first.deep_dup }
      apply("study_guide" => guide)
      expect(task.reload).to be_failed
      expect(task.result).to be_nil
    end
  end

  [ "question", "why_it_matters", "answer", "example" ].each do |field|
    it "rejects a question with a blank #{field}" do
      guide["questions"][0][field] = "  "
      apply("study_guide" => guide)
      expect(task.reload).to be_failed
      expect(task.result).to be_nil
    end
  end

  it "rejects repeated prompts within a batch after case, whitespace and punctuation normalization" do
    guide["questions"][1]["question"] = " HOW do you reconcile STOCK 1!!! "
    apply("study_guide" => guide)
    expect(task.reload).to be_failed
    expect(task.error_message).to include("repeated")
  end

  it "rejects prompts already saved for this job, even if absent from an old enqueue snapshot" do
    create(:ai_task, user: user, subject: job, task_type: "generate_study_guide", status: "completed",
      result: { "study_guide" => guide })
    apply("study_guide" => guide)
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
    expect(task.error_message).to include("repeated")
  end

  let(:diagram) do
    { "caption" => "Stock reconciliation", "explanation" => "Compare the count with the record.",
      "nodes" => [ { "id" => "count", "label" => "Physical count" }, { "id" => "record", "label" => "Stock record" } ],
      "edges" => [ { "from_node" => "count", "to_node" => "record", "label" => "Compare with" } ] }
  end

  it "retains an optional structured diagram with its answer" do
    guide["questions"][0]["diagram"] = diagram
    apply("study_guide" => guide)
    expect(task.reload).to be_completed
    expect(task.result.dig("study_guide", "questions", 0, "diagram")).to eq(diagram)
  end

  it "rejects a diagram referencing an unknown node" do
    diagram["edges"][0]["to_node"] = "missing"
    guide["questions"][0]["diagram"] = diagram
    apply("study_guide" => guide)
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
  end

  %w[duplicate_id too_many_nodes too_many_edges oversized_label markup_field unused_node self_loop duplicate_edge].each do |change|
    it "rejects an invalid diagram: #{change}" do
      case change
      when "duplicate_id" then diagram["nodes"][1]["id"] = "count"
      when "too_many_nodes" then diagram["nodes"] *= 4
      when "too_many_edges" then diagram["edges"] *= 9
      when "oversized_label" then diagram["nodes"][0]["label"] = "x" * 161
      when "markup_field" then diagram["html"] = "<script>alert(1)</script>"
      when "unused_node" then diagram["nodes"] << { "id" => "unused", "label" => "Unused" }
      when "self_loop" then diagram["edges"][0]["to_node"] = "count"
      when "duplicate_edge" then diagram["edges"] *= 2
      end
      guide["questions"][0]["diagram"] = diagram
      apply("study_guide" => guide)
      expect(task.reload).to be_failed
      expect(task.result).to be_nil
    end
  end

  it "retains a valid guide and immutable source, ignoring duplicate result delivery" do
    apply("study_guide" => guide)
    apply("study_guide" => { "title" => "duplicate" })
    expect(task.reload).to be_completed
    expect(task.result).to eq("study_guide" => guide)
    expect(task.input["description"]).to eq("Reconcile inventory.")
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: task.id }, task).once
    expect(task.ai_task_outcomes.count).to eq(1)
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
    expect(requested.value.input).to eq("job_id" => job.id)
    expect(job.ai_tasks.count).to eq(2)
    expect(task.reload.result).to eq("study_guide" => guide)
  end
  it "accepts reference-only work with an execution fingerprint and preserves freshness without source copies" do
    task.update!(input: { job_id: job.id })
    fingerprint = StudyGuides::DescriptionFingerprint.fingerprint(job.description)
    Jobs::UpdateJobService.call(job: job, attributes: { description: "Updated after source read." })
    apply("study_guide" => guide, "source_description_fingerprint" => fingerprint)
    expect(task.reload).to be_completed
    expect(task.input).to eq("job_id" => job.id)
    expect(task.result).to eq("study_guide" => guide, "source_description_fingerprint" => fingerprint)
    expect(StudyGuides::DescriptionFingerprint.task_out_of_date?(task, description: job.reload.description)).to be(true)
    read = StudyGuides::ListGuidesService.call(job: job, user: user)
    expect(read.value[:guides].sole).to include(source_description_fingerprint: fingerprint, out_of_date: true)
    questions = StudyGuides::ListQuestionBatchesService.call(job: job, user: user)
    expect(questions.value[:batches].sole).to include(source_description_fingerprint: fingerprint, out_of_date: true)
  end

  it "rejects reference-only results without an execution fingerprint" do
    task.update!(input: { job_id: job.id })
    apply("study_guide" => guide)
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
  end

  it "rejects copied source metadata in completed results" do
    task.update!(input: { job_id: job.id })
    apply("study_guide" => guide, "source_description_fingerprint" => StudyGuides::DescriptionFingerprint.fingerprint(job.description), "description" => job.description)
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
  end
end
