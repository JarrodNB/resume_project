# Exercise preference checks through authenticated GraphQL and the durable task lifecycle.
require "rails_helper"
RSpec.describe "Job preference checks" do
  let(:user) { create(:user) }
  let(:listing) { create(:job_board_listing, payload: { title: "Engineer", description: "<p>Fully remote within the US.</p>" }) }
  let(:mutation) { 'mutation($id: ID!, $revision: Int!, $digest: String!) { checkJobBoardPreferences(input: {listingId: $id, expectedDigest: $digest, confirmedRevision: $revision}) { aiTask { id status input } errors } }' }
  before do
    allow(Shoryuken::Client).to receive_message_chain(:queues, :send_message)
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 0, action: :save_draft, criteria: [{text: "Fully remote", priority: "must_have"}])
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 1, action: :confirm)
  end
  def request(revision: 2, id: listing.id, owner: user)
    execute_graphql(mutation, user: owner, variables: {id: id, revision: revision, digest: JobBoard::PreferenceListingSnapshot.new(listing).digest})
  end
  it "queues a frozen listing and the owner's confirmed preferences without saving a Job" do
    response = request
    expect(response.dig("data", "checkJobBoardPreferences", "errors")).to eq([])
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    expect(task.task_type).to eq("check_job_preferences")
    expect(task.input["confirmed_revision"]).to eq(2)
    expect(task.input["criteria"].first["text"]).to eq("Fully remote")
    expect(task.input["listings"].first["passages"].map { |p| p["text"] }.join).to include("Fully remote within the US.")
    expect(Job.count).to eq(0)
  end
  def outcome(task, support: "P2", contradiction: nil)
    item = task.input["listings"].first
    evidence = ->(id) { id && item["passages"].find { |p| p["id"] == id }.then { |p| {"passage_id" => p["id"], "text" => p["text"]} } }
    {"confirmed_revision" => 2, "listings" => [{"id" => listing.id, "source_digest" => item["source_digest"],
      "criteria" => [{"id" => task.input["criteria"].first["id"], "status" => "matching", "reason" => "supported",
        "support" => evidence.call(support), "contradiction" => evidence.call(contradiction)}]}]}
  end

  it "accepts exact evidence once and keeps private results owner scoped" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    value = outcome(task)
    message = {"ai_task_id" => task.id, "status" => "completed", "result" => value}
    2.times { AiTasks::ApplyAiResultService.call(message: message) }
    expect(task.reload).to be_completed
    expect(task.result).to eq(value)
    expect(task.ai_task_outcomes.count).to eq(1)
    foreign = execute_graphql('query($id: ID!) { aiTask(id: $id) { id result } }', user: create(:user), variables: {id: task.id})
    expect(foreign["errors"].first["message"]).to eq("Record not found")
  end

  it "rejects fabricated evidence instead of storing an ungrounded match" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    value = outcome(task)
    value["listings"].first["criteria"].first["support"]["text"] = "Invented promise"
    AiTasks::ApplyAiResultService.call(message: {"ai_task_id" => task.id, "status" => "completed", "result" => value})
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
  end
  it "rejects missing confirmation, stale revisions and changed browser sources before queueing" do
    expect(request(owner: create(:user)).dig("data", "checkJobBoardPreferences", "errors")).not_to be_empty
    expect(request(revision: 1).dig("data", "checkJobBoardPreferences", "errors")).not_to be_empty
    response = execute_graphql(mutation, user: user, variables: {id: listing.id, revision: 2, digest: "old"})
    expect(response.dig("data", "checkJobBoardPreferences", "errors")).to include(/listing changed/)
    expect(user.ai_tasks.reload).to be_empty
  end

  it "reuses pending work before admission but never shares it with another owner" do
    first = request.dig("data", "checkJobBoardPreferences", "aiTask", "id")
    allow(AiUsage::CheckAiTaskAllowanceService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: ["Budget reached"]))
    expect(request.dig("data", "checkJobBoardPreferences", "aiTask", "id")).to eq(first)
    expect(user.ai_tasks.count).to eq(1)
    expect(Shoryuken::Client).to have_received(:queues).once
  end

  it "rejects stale outcomes after a newly confirmed profile but retains charged usage" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    value = outcome(task)
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 2, action: :clear)
    AiTasks::ApplyAiResultService.call(message: {"ai_task_id" => task.id, "status" => "completed", "result" => value,
      "usage" => [{"input_tokens" => 100, "cost_microdollars" => 4}]})
    expect(task.reload).to be_failed
    expect(task.input_tokens).to eq(100)
    expect(task.cost_microdollars).to eq(4)
    expect(task.result).to be_nil
  end

  it "rejects outcomes after catalogue content changes" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    listing.update!(payload: {title: "Now onsite", description: "Office attendance required."})
    AiTasks::ApplyAiResultService.call(message: {"ai_task_id" => task.id, "status" => "completed", "result" => outcome(task)})
    expect(task.reload).to be_failed
    expect(task.error_message).to include("changed")
  end

  it "validates every listing and criterion identity and rejects unsupported statuses" do
    3.times do |index|
      request
      task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
      value = outcome(task)
      if index == 0
        value["listings"].first["id"] = SecureRandom.uuid
      elsif index == 1
        value["listings"].first["criteria"].first["id"] = SecureRandom.uuid
      else
        value["listings"].first["criteria"].first["status"] = "conflicting"
      end
      AiTasks::ApplyAiResultService.call(message: {"ai_task_id" => task.id, "status" => "completed", "result" => value})
      expect(task.reload).to be_failed
    end
  end

  it "preserves generated and completed-check provenance only for exact owner sources" do
    profile = user.job_preference_profile
    criterion = profile.confirmed_criteria.first
    user.ai_tasks.create!(task_type: "generate_summary", status: "completed", result: {criteria: [criterion]})
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    expect(task.input["criteria"].first["trusted_generated"]).to be(false)
    AiTasks::ApplyAiResultService.call(message: {"ai_task_id" => task.id, "status" => "completed", "result" => outcome(task)})
    request
    next_task = user.ai_tasks.order(created_at: :desc).first
    expect(next_task.input["criteria"].first["screened"]).to be(true)
    expect(next_task.input["listings"].first["screened"]).to be(true)
  end
  it "bounds short-line passage counts and marks omitted content honestly" do
    listing.update!(payload: {title: "Engineer", description: (1..90).map { |n| "Line #{n}" }.join("\n")})
    expect(request.dig("data", "checkJobBoardPreferences", "errors")).to eq([])
    item = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first.input["listings"].first
    expect(item["passages"].size).to eq(64)
    expect(item["truncated"]).to be(true)
    expect(item["source_digest"]).to eq(JobBoard::PreferenceListingSnapshot.new(listing).digest)
  end
end
