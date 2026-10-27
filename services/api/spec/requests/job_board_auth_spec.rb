# Both Job Board operations use the HTTP endpoint's authentication gate.
require "rails_helper"

RSpec.describe "Job Board authentication", type: :request do
  it "rejects signed-out search and import before reading or writing shared or private data" do
    expect(JobBoard::SuggestLocationsService).not_to receive(:call)
    expect(JobBoard::SearchCatalogueService).not_to receive(:call)
    expect(JobBoard::ImportListingService).not_to receive(:call)
    queries = [
      '{ jobBoardLocations(query: "Boston") { errors } }',
      '{ jobBoardSearch(keyword: "Engineer") { errors } }',
      'mutation { importJobBoardListing(input: { listingId: "unknown" }) { errors } }'
    ]
    queries.each do |query|
      post "/graphql", params: { query: query }.to_json, headers: { "CONTENT_TYPE" => "application/json", "ACCEPT" => "application/json" }
      expect(response).to have_http_status(:unauthorized)
    end
    expect(Job.count).to eq(0)
    expect(JobBoardSearchPage.count).to eq(0)
  end
end
