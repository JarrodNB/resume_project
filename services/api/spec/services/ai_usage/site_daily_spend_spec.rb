# Proves the site-wide limit adds up everyone's spend for one UTC day, and caches the total briefly.
require "rails_helper"

RSpec.describe AiUsage::SiteDailySpend do
  around { |example| travel_to(Time.utc(2026, 11, 4, 12)) { example.run } }

  it "adds known general AI, spoken interview and embedding costs across users" do
    create(:ai_task, cost_microdollars: 100)
    create(:ai_task, task_type: "interview_turn", cost_microdollars: 20)
    AiEmbeddingRequest.create!(user: create(:user), model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: 3)

    expect(described_class.known_microdollars).to eq(123)
  end

  it "ignores earlier UTC days and embeddings with an unknown cost" do
    create(:ai_task, cost_microdollars: 100, created_at: Time.utc(2026, 11, 3, 23, 59))
    AiEmbeddingRequest.create!(user: create(:user), model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: 100, created_at: Time.utc(2026, 11, 3, 23, 59))
    AiEmbeddingRequest.create!(user: create(:user), model: "text-embedding-3-small", purpose: "career_library", cost_microdollars: nil)

    expect(described_class.known_microdollars).to eq(0)
  end

  it "is reached exactly at the budget" do
    stub_const("SITE_DAILY_AI_BUDGET_MICRODOLLARS", 100)
    create(:ai_task, cost_microdollars: 99)
    expect(described_class).not_to be_limit_reached

    create(:ai_task, cost_microdollars: 1)
    expect(described_class).to be_limit_reached
  end

  context "with a real cache" do
    before { allow(Rails).to receive(:cache).and_return(ActiveSupport::Cache::MemoryStore.new) }

    it "reuses the total until the short cache expires" do
      create(:ai_task, cost_microdollars: 100)
      expect(described_class.known_microdollars).to eq(100)

      create(:ai_task, cost_microdollars: 50)
      expect(described_class.known_microdollars).to eq(100)

      travel described_class::CACHE_TTL + 1.second
      expect(described_class.known_microdollars).to eq(150)
    end
  end
end
