# Description: One account can only cause so many Job Board provider calls per hour.
require "rails_helper"

RSpec.describe JobBoard::ProviderCallLimit do
  let(:user) { create(:user) }
  let(:provider_result) { ServiceResult.new(success: true, value: { listings: [], next_cursor: nil }, errors: []) }
  let(:search_query) { "query($keyword: String!) { jobBoardSearch(keyword: $keyword) { listings { id } errors stale } }" }
  let(:locations_query) { "query($query: String!) { jobBoardLocations(query: $query) { locations { label } errors } }" }

  around do |example|
    original_store = Rails.cache
    Rails.cache = ActiveSupport::Cache::MemoryStore.new
    example.run
  ensure
    Rails.cache = original_store
  end

  before do
    stub_const("JobBoard::ProviderCallLimit::LIMITS", { search: 2, locations: 1 })
    allow(JobBoard::SearchCleanJobDataService).to receive(:call).and_return(provider_result)
    allow(JobBoard::SuggestLocationsService).to receive(:call).and_return(ServiceResult.new(success: true, value: { locations: [], errors: [] }, errors: []))
  end

  def search(keyword, as: user) = execute_graphql(search_query, user: as, variables: { keyword: keyword }).dig("data", "jobBoardSearch")

  it "stops provider calls after the hourly limit without calling the provider again" do
    expect(search("ruby")["errors"]).to eq([])
    expect(search("python")["errors"]).to eq([])

    refused = search("golang")

    expect(refused["errors"]).to eq([ described_class::MESSAGE ])
    expect(JobBoard::SearchCleanJobDataService).to have_received(:call).twice
  end

  it "does not count searches answered from the shared cache" do
    4.times { expect(search("ruby")["errors"]).to eq([]) }

    expect(JobBoard::SearchCleanJobDataService).to have_received(:call).once
  end

  it "limits each account separately" do
    2.times { |index| search("keyword #{index}") }
    expect(search("another")["errors"]).to eq([ described_class::MESSAGE ])

    expect(search("another", as: create(:user))["errors"]).to eq([])
  end

  it "starts a fresh count in the next hour" do
    travel_to(Time.utc(2026, 11, 26, 10, 30)) { 2.times { |index| search("keyword #{index}") } }

    travel_to(Time.utc(2026, 11, 26, 11, 1)) { expect(search("fresh")["errors"]).to eq([]) }
  end

  it "limits location lookups, which are never cached" do
    first = execute_graphql(locations_query, user: user, variables: { query: "Bos" }).dig("data", "jobBoardLocations")
    second = execute_graphql(locations_query, user: user, variables: { query: "Bost" }).dig("data", "jobBoardLocations")

    expect(first["errors"]).to eq([])
    expect(second["errors"]).to eq([ described_class::MESSAGE ])
    expect(JobBoard::SuggestLocationsService).to have_received(:call).once
  end

  it "allows the call when the cache cannot count" do
    Rails.cache = ActiveSupport::Cache::NullStore.new

    3.times { |index| expect(search("keyword #{index}")["errors"]).to eq([]) }
  end
end
