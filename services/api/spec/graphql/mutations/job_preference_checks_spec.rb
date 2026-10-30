# Exercise preference checks through authenticated GraphQL and the durable task lifecycle.
require "rails_helper"
RSpec.describe "Job preference checks" do
  let(:user) { create(:user) }
  let(:listing) { create(:job_board_listing, payload: { title: "Engineer", description: "<p>Fully remote within the US.</p>" }) }
  let(:mutation) { 'mutation($id: ID!, $revision: Int!, $digest: String!) { checkJobBoardPreferenceResults(input: {listings: [{listingId: $id, expectedDigest: $digest}], confirmedRevision: $revision}) { aiTask { id status input } errors } }' }
  before do
    allow(Shoryuken::Client).to receive_message_chain(:queues, :send_message)
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 0, action: :save_draft, criteria: [ { text: "Fully remote", priority: "must_have" } ])
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 1, action: :confirm)
  end
  def request(revision: 2, id: listing.id, owner: user)
    execute_graphql(mutation, user: owner, variables: { id: id, revision: revision, digest: JobBoard::PreferenceListingSnapshot.new(listing).digest })
  end

  def request_batch(listings, revision: 2)
    execute_graphql(<<~GQL, user: user, variables: { listings: listings.map { |item| { listingId: item.id, expectedDigest: JobBoard::PreferenceListingSnapshot.new(item).digest } }, revision: revision })
      mutation($listings: [JobPreferenceListingInput!]!, $revision: Int!) {
        checkJobBoardPreferenceResults(input: {listings: $listings, confirmedRevision: $revision}) { aiTask { id status input } errors }
      }
    GQL
  end

  it "checks all loaded catalogue identities in one frozen task, retaining their provider order" do
    second = create(:job_board_listing, payload: { title: "Second", description: "Office attendance required." })
    expect { @batch = request_batch([ listing, second ]) }.to change(AiTask, :count).by(1)
    expect(@batch.dig("data", "checkJobBoardPreferenceResults", "errors")).to eq([])
    task = user.ai_tasks.last
    expect(task.input["listings"].map { |item| item["id"] }).to eq([ listing.id, second.id ])
    expect(task.input.to_json.bytesize).to be < 200_000
    expect(Shoryuken::Client).to have_received(:queues).once
  end

  it "canonicalizes uppercase UUIDs and rejects case variants of the same listing" do
    digest = JobBoard::PreferenceListingSnapshot.new(listing).digest
    expect(request(id: listing.id.upcase).dig("data", "checkJobBoardPreferenceResults", "errors")).to eq([])
    service = JobPreferences::StartCheckService.call(user: user, confirmed_revision: 2,
      listings: [ { listing_id: listing.id.upcase, expected_digest: digest }, { listing_id: listing.id, expected_digest: digest } ])
    expect(service).not_to be_success
    expect(service.errors).to include(/distinct/)
  end

  it "rejects duplicate, excessive, stale and overlarge batch evidence before model admission" do
    expect(request_batch([ listing, listing ]).dig("data", "checkJobBoardPreferenceResults", "errors")).not_to be_empty
    expect(request_batch(Array.new(101, listing)).dig("data", "checkJobBoardPreferenceResults", "errors")).not_to be_empty
    expect(request_batch([ listing ], revision: 1).dig("data", "checkJobBoardPreferenceResults", "errors")).not_to be_empty
    empty = create(:job_board_listing, payload: {})
    expect(request_batch([ empty ]).dig("data", "checkJobBoardPreferenceResults", "errors")).to include(/no usable posting text/)
    long = (1..100).map { create(:job_board_listing, payload: { title: "Engineer", description: "x" * 8000 }) }
    profile = user.job_preference_profile
    JobPreferences::UpdateProfileService.call(user: user, expected_version: profile.version, action: :save_draft,
      criteria: Array.new(10) { |n| { text: "Preference #{n}", priority: "must_have" } })
    JobPreferences::UpdateProfileService.call(user: user, expected_version: profile.version + 1, action: :confirm)
    result = request_batch(long, revision: profile.version + 2)
    expect(result.dig("data", "checkJobBoardPreferenceResults", "errors")).to include(/too much listing evidence/)
    expect(user.ai_tasks.reload).to be_empty
  end

  it "validates full batch coverage and stale content while accepting exact results once" do
    second = create(:job_board_listing, payload: { title: "Second", description: "Fully remote." })
    request_batch([ listing, second ])
    task = user.ai_tasks.last
    decisions = task.input["listings"].map do |item|
      { "id" => item["id"], "source_digest" => item["source_digest"], "truncated" => item["truncated"], "evidence_passages" => [], "criteria" => task.input["criteria"].map do |criterion|
        { "id" => criterion["id"], "status" => "unknown", "reason" => item["truncated"] ? "incomplete_source" : "not_stated", "support" => nil, "contradiction" => nil }
      end }
    end
    complete = { "confirmed_revision" => 2, "listings" => decisions }
    expect(JobPreferences::ValidateCheckResultService.call(ai_task: task, result: complete.merge("listings" => decisions.reverse))).not_to be_success
    expect(JobPreferences::ValidateCheckResultService.call(ai_task: task, result: complete.merge("listings" => decisions.take(1)))).not_to be_success
    2.times { AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => complete }) }
    expect(task.reload).to be_completed
    expect(task.ai_task_outcomes.count).to eq(1)
  end

  it "admits a normal first page with all ten criteria using compact exact evidence" do
    criteria = Array.new(10) { |n| { text: "Condition #{n}", priority: "must_have" } }
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 2, action: :save_draft, criteria: criteria)
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 3, action: :confirm)
    listings = Array.new(20) { create(:job_board_listing, payload: { title: "Engineer", description: "Role requirements. " * 500 }) }
    response = request_batch(listings, revision: 4)
    expect(response.dig("data", "checkJobBoardPreferenceResults", "errors")).to eq([])
    expect(user.ai_tasks.last.input["listings"].size).to eq(20)
  end

  it "does not reuse a partial batch screening check to approve previously unseen text" do
    listing.update!(payload: { title: "Engineer", description: "First part. " * 900 })
    profile = user.job_preference_profile
    short = JobBoard::PreferenceListingSnapshot.new(listing).snapshot(max_text_bytes: 1200)
    user.ai_tasks.create!(task_type: "check_job_preferences", status: "completed", input: { listings: [ short ], criteria: profile.confirmed_criteria })
    request
    expect(user.ai_tasks.order(created_at: :desc).first.input["listings"].first["screened"]).to be(false)
  end
  it "queues a frozen listing and the owner's confirmed preferences without saving a Job" do
    response = request
    expect(response.dig("data", "checkJobBoardPreferenceResults", "errors")).to eq([])
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    expect(task.task_type).to eq("check_job_preferences")
    expect(task.input["confirmed_revision"]).to eq(2)
    expect(task.input["criteria"].first["text"]).to eq("Fully remote")
    expect(task.input["listings"].first["passages"].map { |p| p["text"] }.join).to include("Fully remote within the US.")
    expect(Job.count).to eq(0)
  end
  def outcome(task, support: "P2", contradiction: nil)
    item = task.input["listings"].first
    evidence = ->(id) { id && item["passages"].find { |p| p["id"] == id }.then { |p| { "passage_id" => p["id"], "text" => p["text"] } } }
    { "confirmed_revision" => 2, "listings" => [ { "id" => listing.id, "source_digest" => item["source_digest"], "truncated" => item["truncated"],
      "evidence_passages" => [ evidence.call(support), evidence.call(contradiction) ].compact.uniq,
      "criteria" => [ { "id" => task.input["criteria"].first["id"], "status" => "matching", "reason" => "supported",
        "support" => support && { "passage_id" => support }, "contradiction" => contradiction && { "passage_id" => contradiction } } ] } ] }
  end

  it "accepts exact evidence once and keeps private results owner scoped" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    value = outcome(task)
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => value }
    2.times { AiTasks::ApplyAiResultService.call(message: message) }
    expect(task.reload).to be_completed
    expect(task.result).to eq(value)
    expect(task.ai_task_outcomes.count).to eq(1)
    foreign = execute_graphql('query($id: ID!) { aiTask(id: $id) { id result } }', user: create(:user), variables: { id: task.id })
    expect(foreign["errors"].first["message"]).to eq("Record not found")
  end

  it "rejects fabricated evidence instead of storing an ungrounded match" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    value = outcome(task)
    value["listings"].first["evidence_passages"].first["text"] = "Invented promise"
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => value })
    expect(task.reload).to be_failed
    expect(task.result).to be_nil
  end
  it "rejects missing confirmation, stale revisions and changed browser sources before queueing" do
    expect(request(owner: create(:user)).dig("data", "checkJobBoardPreferenceResults", "errors")).not_to be_empty
    expect(request(revision: 1).dig("data", "checkJobBoardPreferenceResults", "errors")).not_to be_empty
    response = execute_graphql(mutation, user: user, variables: { id: listing.id, revision: 2, digest: "old" })
    expect(response.dig("data", "checkJobBoardPreferenceResults", "errors")).to include(/listing changed/)
    expect(user.ai_tasks.reload).to be_empty
  end

  it "reuses pending work before admission but never shares it with another owner" do
    first = request.dig("data", "checkJobBoardPreferenceResults", "aiTask", "id")
    allow(AiUsage::CheckAiTaskAllowanceService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Budget reached" ]))
    expect(request.dig("data", "checkJobBoardPreferenceResults", "aiTask", "id")).to eq(first)
    expect(user.ai_tasks.count).to eq(1)
    expect(Shoryuken::Client).to have_received(:queues).once
  end

  it "rejects stale outcomes after a newly confirmed profile but retains charged usage" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    value = outcome(task)
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 2, action: :clear)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => value,
      "usage" => [ { "input_tokens" => 100, "cost_microdollars" => 4 } ] })
    expect(task.reload).to be_failed
    expect(task.input_tokens).to eq(100)
    expect(task.cost_microdollars).to eq(4)
    expect(task.result).to be_nil
  end

  it "rejects outcomes after catalogue content changes" do
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    listing.update!(payload: { title: "Now onsite", description: "Office attendance required." })
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => outcome(task) })
    expect(task.reload).to be_failed
    expect(task.error_message).to include("changed")
  end

  it "validates every listing and criterion identity and rejects unsupported statuses" do
    4.times do |index|
      request
      task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
      value = outcome(task)
      if index == 0
        value["listings"].first["id"] = SecureRandom.uuid
      elsif index == 1
        value["listings"].first["criteria"].first["id"] = SecureRandom.uuid
      elsif index == 2
        value["listings"].first["criteria"].first["status"] = "conflicting"
      else
        value["listings"].first["truncated"] = !value["listings"].first["truncated"]
      end
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => value })
      expect(task.reload).to be_failed
    end
  end

  it "reuses completed-check screening only for exact owner sources" do
    profile = user.job_preference_profile
    criterion = profile.confirmed_criteria.first
    user.ai_tasks.create!(task_type: "generate_summary", status: "completed", result: { criteria: [ criterion ] })
    request
    task = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first
    expect(task.input["criteria"].first["trusted_generated"]).to be(false)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => outcome(task) })
    request
    next_task = user.ai_tasks.order(created_at: :desc).first
    expect(next_task.input["criteria"].first["screened"]).to be(true)
    expect(next_task.input["listings"].first["screened"]).to be(true)
  end
  [ [ "completed", "result" ], [ "completed", "input" ], [ "needs_user_input", "input" ] ].each do |status, source|
    it "reuses exact owner historical #{source} provenance from a #{status} retired conversation" do
      criterion = user.job_preference_profile.confirmed_criteria.first
      attributes = ->(value) { { task_type: "elicit_job_preferences", status: status, source => { "criteria" => [ value ] } } }
      create(:user).ai_tasks.create!(attributes.call(criterion))
      user.ai_tasks.create!(attributes.call(criterion.merge("text" => "Fully remote elsewhere")))
      first = request.dig("data", "checkJobBoardPreferenceResults", "aiTask", "input", "criteria").first
      expect(first.fetch("trusted_generated", false)).to be(false)
      expect(first["screened"]).to be(false)

      user.ai_tasks.create!(attributes.call(criterion))
      current = request.dig("data", "checkJobBoardPreferenceResults", "aiTask", "input", "criteria").first
      if source == "result"
        expect(current["trusted_generated"]).to be(true)
      else
        expect(current["screened"]).to be(true)
      end
    end
  end

  it "bounds short-line passage counts and marks omitted content honestly" do
    listing.update!(payload: { title: "Engineer", description: (1..90).map { |n| "Line #{n}" }.join("\n") })
    expect(request.dig("data", "checkJobBoardPreferenceResults", "errors")).to eq([])
    item = user.ai_tasks.where(task_type: "check_job_preferences").order(created_at: :desc).first.input["listings"].first
    expect(item["passages"].size).to eq(64)
    expect(item["truncated"]).to be(true)
    expect(item["source_digest"]).to eq(JobBoard::PreferenceListingSnapshot.new(listing).digest)
  end

  it "reuses exact text screening when only a criterion's priority changes" do
    request
    task = user.ai_tasks.last
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => outcome(task) })
    criterion = user.reload.job_preference_profile.confirmed_criteria.first
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 2, action: :save_draft, criteria: [ criterion.merge("priority" => "nice_to_have") ])
    JobPreferences::UpdateProfileService.call(user: user, expected_version: 3, action: :confirm)
    request(revision: 4)
    expect(user.ai_tasks.order(created_at: :desc).first.input["criteria"].first["screened"]).to be(true)
  end
end
