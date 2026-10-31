# Exercise ranking requests and result application through the public mutation and task lifecycle.
require "rails_helper"

RSpec.describe "Job Board reranking" do
  let(:user) { create(:user) }
  let(:mutation) { 'mutation($keyword: String!, $ids: [ID!]!) { rerankJobBoardListings(input: {keyword: $keyword, listingIds: $ids}) { aiTask { id status input } errors } }' }
  let(:listing) { create(:job_board_listing, payload: { title: "Ruby engineer", description: "<p>Build APIs.</p>" }) }

  before { allow(Shoryuken::Client).to receive_message_chain(:queues, :send_message) }

  def request(ids: [ listing.id ], keyword: "Ruby engineer")
    execute_graphql(mutation, user: user, variables: { keyword: keyword, ids: ids })
  end

  def add_embeddings(owner = user, model: CareerLibraryEmbeddings::MODEL)
    owner.library_embeddings.create!(source_type: "Skill", source_id: SecureRandom.uuid,
      content: "Ruby", content_digest: "fixture", model: model,
      embedding: Array.new(CareerLibraryEmbeddings::DIMENSIONS, 0.01))
  end

  it "queues only selected catalogue IDs and the search keyword" do
    add_embeddings
    response = request
    expect(response.dig("data", "rerankJobBoardListings", "errors")).to eq([])
    task = user.ai_tasks.last
    expect(task.task_type).to eq("rerank_job_listings")
    expect(task.input).to eq("keyword" => "Ruby engineer", "listing_ids" => [ listing.id ])
    expect(Job.count).to eq(0)
  end

  it "does not use another user's library embeddings" do
    add_embeddings(create(:user))
    response = request
    expect(response.dig("data", "rerankJobBoardListings", "errors")).to include(/career library/)
    expect(user.ai_tasks.reload).to be_empty
  end
  it "rejects invalid candidate sets before queueing" do
    add_embeddings
    [ [], [ "not-a-uuid" ], [ SecureRandom.uuid ], [ listing.id, listing.id ], Array.new(101) { SecureRandom.uuid } ].each do |ids|
      expect(request(ids: ids).dig("data", "rerankJobBoardListings", "errors")).not_to be_empty
    end
    expect(request(keyword: " ").dig("data", "rerankJobBoardListings", "errors")).not_to be_empty
    expect(user.ai_tasks.reload).to be_empty
  end

  it "reuses identical pending work before another allowance check or queue publish" do
    add_embeddings
    first = request.dig("data", "rerankJobBoardListings", "aiTask", "id")
    allow(AiUsage::CheckAiTaskAllowanceService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Budget reached" ]))
    second = request.dig("data", "rerankJobBoardListings", "aiTask", "id")
    expect(second).to eq(first)
    expect(user.ai_tasks.count).to eq(1)
    expect(Shoryuken::Client).to have_received(:queues).once
  end

  it "respects allowances without storing a task" do
    add_embeddings
    allow(AiUsage::CheckAiTaskAllowanceService).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Budget reached" ]))
    expect(request.dig("data", "rerankJobBoardListings", "errors")).to eq([ "Budget reached" ])
    expect(user.ai_tasks.reload).to be_empty
    expect(Shoryuken::Client).not_to have_received(:queues)
  end

  it "keeps only IDs even when the selected catalogue contains large multibyte text" do
    add_embeddings
    ids = 100.times.map { create(:job_board_listing, payload: { title: "開発者", description: "資料" * 4000 }).id }
    expect(request(ids: ids).dig("data", "rerankJobBoardListings", "errors")).to eq([])
    expect(user.ai_tasks.last.input).to eq("keyword" => "Ruby engineer", "listing_ids" => ids)
  end

  it "accepts only exact candidate permutations and keeps finished results under duplicate delivery" do
    add_embeddings
    other = create(:job_board_listing)
    request(ids: [ listing.id, other.id ])
    task = user.ai_tasks.last
    allow(ApiSchema.subscriptions).to receive(:trigger)
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "ranked_listing_ids" => [ other.id, listing.id ] } }
    2.times { AiTasks::ApplyAiResultService.call(message: message) }
    expect(task.reload).to be_completed
    expect(task.result).to eq(message["result"])
    expect(task.ai_task_outcomes.count).to eq(1)
    AiTasks::ApplyAiResultService.call(message: message.merge("result" => { "ranked_listing_ids" => [] }))
    expect(task.reload.result).to eq(message["result"])
    foreign = execute_graphql('query($id: ID!) { aiTask(id: $id) { id result } }', user: create(:user), variables: { id: task.id })
    expect(foreign["errors"].first["message"]).to eq("Record not found")
  end

  it "fails invalid worker rankings instead of storing dropped, repeated or foreign candidates" do
    add_embeddings
    other = create(:job_board_listing)
    allow(ApiSchema.subscriptions).to receive(:trigger)
    [ [], [ listing.id, listing.id ], [ listing.id, SecureRandom.uuid ], [ listing.id, 4 ], nil ].each do |ids|
      request(ids: [ listing.id, other.id ])
      task = user.ai_tasks.last
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "ranked_listing_ids" => ids } })
      expect(task.reload).to be_failed
      expect(task.result).to be_nil
      expect(task.error_message).to include("did not match")
    end
  end
  it "requires the configured embedding model and never shares pending tasks across owners" do
    add_embeddings(model: "old-embedding-model")
    expect(request.dig("data", "rerankJobBoardListings", "errors")).to include(/career library/)
    add_embeddings
    request
    first = user.ai_tasks.last
    other_user = create(:user)
    add_embeddings(other_user)
    other = JobBoard::StartRerankingService.call(user: other_user, listing_ids: [ listing.id ], keyword: "Ruby engineer")
    expect(other).to be_success
    expect(other.value.user).to eq(other_user)
    expect(other.value.id).not_to eq(first.id)
  end

  it "does not charge escaped catalogue text against the command budget" do
    add_embeddings
    ids = 40.times.map { create(:job_board_listing, payload: { title: "\u0001" * 4000 }).id }
    expect(request(ids: ids).dig("data", "rerankJobBoardListings", "errors")).to eq([])
    expect(user.ai_tasks.last.input.keys).to contain_exactly("keyword", "listing_ids")
  end
  it "accepts retained legacy task IDs without depending on copied text" do
    task = create(:ai_task, user: user, task_type: "rerank_job_listings",
      input: { "keyword" => "Ruby", "listings" => [ { "id" => listing.id, "text" => "Old copied source" } ] })
    result = JobBoard::ValidateRerankingResultService.call(ai_task: task,
      result: { "ranked_listing_ids" => [ listing.id ] })
    expect(result).to be_success
  end
end
