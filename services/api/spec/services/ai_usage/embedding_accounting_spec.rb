# Provider stubs exercise durable batch receipts independently of rolled-back vector writes.
require "rails_helper"

RSpec.describe "Background embedding accounting" do
  self.use_transactional_tests = false
  let(:user) { create(:user) }
  let(:endpoint) { instance_double(OpenAI::Resources::Embeddings) }
  let(:sdk) { instance_double(OpenAI::Client, embeddings: endpoint) }
  let(:client) { Embeddings::OpenAiEmbeddingClient.new(user: user, purpose: "career_library", dimensions: 2) }

  before { allow(OpenAI::Client).to receive(:new).and_return(sdk) }
  after { user.destroy! if User.exists?(user.id) }

  def receipt(count: 1, tokens: 1_000, model: "text-embedding-3-small")
    OpenAI::Models::CreateEmbeddingResponse.new(model: model, object: "list",
      usage: OpenAI::Models::CreateEmbeddingResponse::Usage.new(prompt_tokens: tokens, total_tokens: tokens),
      data: count.times.map { |index| OpenAI::Models::Embedding.new(index: index, object: :embedding, embedding: [ 0.0, 1.0 ]) })
  end

  it "commits a marker before dispatch and retains its bill after an outer rollback" do
    user
    allow(endpoint).to receive(:create) do |params|
      id = params.fetch(:request_options).fetch(:extra_headers).fetch("X-Client-Request-Id")
      expect(user.ai_embedding_requests.find(id)).to have_attributes(incomplete: true, finalized: false)
      receipt
    end
    ActiveRecord::Base.transaction do
      expect(client.embed_texts([ "Synthetic skill" ])).to eq([ [ 0.0, 1.0 ] ])
      raise ActiveRecord::Rollback
    end
    expect(user.ai_embedding_requests.sole).to have_attributes(input_tokens: 1_000, cost_microdollars: 20,
      incomplete: false, finalized: true)
    expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: user).value.spent_microdollars).to eq(20)
    expect(user.ai_tasks.count).to eq(0)
    expect(OpenAI::Client).to have_received(:new).with(api_key: anything, max_retries: 0)
  end

  it "retains partial batch charges and unknown markers across separate job retries" do
    calls = 0
    allow(endpoint).to receive(:create) do |params|
      calls += 1
      raise "provider disconnected" if calls == 2

      receipt(count: params.fetch(:input).size)
    end
    expect { client.embed_texts(Array.new(501, "Synthetic skill")) }.to raise_error("provider disconnected")
    expect(user.ai_embedding_requests.count).to eq(2)
    expect(user.ai_embedding_requests.sum(:cost_microdollars)).to eq(20)
    expect(user.ai_embedding_requests.where(incomplete: true).count).to eq(1)
    client.embed_texts([ "Synthetic retry" ])
    expect(user.ai_embedding_requests.sum(:cost_microdollars)).to eq(40)
    expect(user.ai_embedding_requests.count).to eq(3)
  end

  it "retains a bill before malformed vectors fail validation" do
    allow(endpoint).to receive(:create).and_return(receipt(count: 0))
    expect { client.embed_texts([ "Synthetic skill" ]) }.to raise_error("Incomplete embedding response")
    expect(user.ai_embedding_requests.sole.cost_microdollars).to eq(20)
  end

  it "leaves missing usage and unexpected model pricing incomplete" do
    allow(endpoint).to receive(:create).and_return(receipt(tokens: 0), receipt(model: "unpriced-embedding"))
    2.times { client.embed_texts([ "Synthetic skill" ]) }
    expect(user.ai_embedding_requests.where(incomplete: true).count).to eq(2)
    expect(user.ai_embedding_requests.sum(:cost_microdollars)).to eq(0)
  end

  it "charges the account for saved interview Q&A without changing interview task limits" do
    allow(endpoint).to receive(:create).and_return(receipt)
    account_client = Embeddings::OpenAiEmbeddingClient.new(user: user, purpose: "interview_question", dimensions: 2)
    account_client.embed_texts([ "Question and answer" ])
    expect(user.ai_embedding_requests.sole.purpose).to eq("interview_question")
    expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: user, scope: :interview).value.spent_microdollars).to eq(0)
    expect(AiUsage::SummarizeMonthlyAiUsageService.call(user: user, scope: :general).value.spent_microdollars).to eq(20)
  end
end
