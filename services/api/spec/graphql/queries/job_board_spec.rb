# Exercise catalogue search and private saved-job links through the schema.
require "rails_helper"

RSpec.describe "Job Board search" do
  let(:user) { create(:user) }
  let(:query) do
    <<~GQL
      query($keyword: String!, $remote: Boolean = false, $cursor: String) {
        jobBoardSearch(keyword: $keyword, remoteOnly: $remote, cursor: $cursor) {
          listings { id title company location description applicationUrl remoteType hasRemote published isActive savedJob { id } }
          nextCursor retrievedAt stale errors
        }
      }
    GQL
  end

  def search(**variables)
    execute_graphql(query, user: user, variables: { keyword: "Engineer" }.merge(variables))
  end

  it "returns plain text without creating a saved job" do
    provider_page(data: [ provider_listing.merge(description: "<p>Hello</p><script>bad()</script>", locations: [ { country_code: "US", city_name: "Alpharetta", state_code: "GA" } ]) ])
    page = search.dig("data", "jobBoardSearch")
    expect(page["errors"]).to eq([])
    expect(page["listings"].first["description"]).to eq("Hello")
    expect(page["listings"].first["location"]).to eq("Alpharetta, GA, US")
    expect(Job.count).to eq(0)
  end
  def provider_page(data:, next_cursor: nil, status: "200")
    response = instance_double(Net::HTTPResponse, code: status,
      body: { data: data, meta: {}, pagination: { limit: 20, next_page: next_cursor } }.to_json)
    allow(http).to receive(:request).and_return(response)
  end

  let(:http) { instance_double(Net::HTTP) }
  let(:provider_listing) do
    { id: 71, title: "Engineer", company: { name: "Acme" },
      locations: [ { country_code: "US", display_label: "Boston, MA" } ],
      description: "<h2>Requirements</h2><ul><li>Ruby</li></ul>", application_url: "https://example.com/apply?role=1&utm_source=board",
      remote_type: "Fully remote", has_remote: true, published: "not-a-date", is_active: true }
  end

  before do
    stub_const("ENV", ENV.to_h.merge("CLEANJOBDATA_API_KEY" => "test-provider-key"))
    allow(Net::HTTP).to receive(:new).and_return(http)
    allow(http).to receive(:request)
    allow(http).to receive_messages("use_ssl=" => nil, "open_timeout=" => nil, "read_timeout=" => nil, "write_timeout=" => nil, "max_retries=" => nil)
  end

  it "forwards remote and opaque cursors, returns order and optional fields, and shares the cache" do
    provider_page(data: [ provider_listing, provider_listing.merge(id: 72, title: "Other") ], next_cursor: "opaque")
    page = search(remote: true).dig("data", "jobBoardSearch")
    expect(page).to include("errors" => [], "stale" => false, "nextCursor" => "opaque")
    expect(page["retrievedAt"]).to be_present
    expect(page["listings"].map { |row| row["title"] }).to eq([ "Engineer", "Other" ])
    expect(page["listings"].first).to include("company" => "Acme", "location" => "Boston, MA",
      "remoteType" => "Fully remote", "hasRemote" => true, "published" => "not-a-date", "isActive" => true, "savedJob" => nil)
    expect(page["listings"].first.keys).not_to include("payload", "apiKey")
    other_user = create(:user)
    execute_graphql(query, user: other_user, variables: { keyword: "Engineer", remote: true })
    expect(http).to have_received(:request).once
    provider_page(data: [], next_cursor: nil)
    expect(search(remote: true, cursor: "opaque").dig("data", "jobBoardSearch", "listings")).to eq([])
    expect(http).to have_received(:request).with(have_attributes(path: include("remote=true", "cursor=opaque")))
    expect(Job.count).to eq(0)
  end

  it "returns safe total failure and stale fallback with the original retrieval time" do
    provider_page(data: [], status: "503")
    failed = search.dig("data", "jobBoardSearch")
    expect(failed).to include("listings" => [], "retrievedAt" => nil, "stale" => false,
      "errors" => [ JobBoard::SearchCleanJobDataService::UNAVAILABLE ])
    provider_page(data: [ provider_listing ])
    first = search.dig("data", "jobBoardSearch")
    travel 25.hours
    provider_page(data: [], status: "503")
    stale = search.dig("data", "jobBoardSearch")
    expect(stale).to include("stale" => true, "retrievedAt" => first["retrievedAt"],
      "errors" => [ JobBoard::SearchCleanJobDataService::UNAVAILABLE ])
    expect(stale["listings"]).to eq(first["listings"])
  end

  it "rejects invalid input without HTTP, and GraphQL rejects wrong input types" do
    [ { keyword: "" }, { keyword: "x" * 201 }, { cursor: "" }, { remote: nil } ].each do |variables|
      expect(search(**variables).dig("data", "jobBoardSearch", "errors")).not_to be_empty
    end
    expect(search(remote: "yes")["errors"]).to be_present
    expect(http).not_to have_received(:request)
  end

  it "links only the current owner's source or normalized URL match and preserves meaningful parameters" do
    provider_page(data: [ provider_listing, provider_listing.merge(id: 72), provider_listing.merge(id: 73) ])
    search
    source, url, different = JobBoardListing.order(:provider_id).to_a
    url.update!(payload: { "title" => "URL", "application_url" => "https://example.com/apply?role=1&utm_source=x#top" })
    different.update!(payload: { "title" => "Different", "application_url" => "https://example.com/apply?role=2" })
    create(:job, job_board_listing: source)
    create(:job, url: "https://example.com/apply?role=1")
    expect(search.dig("data", "jobBoardSearch", "listings").map { |row| row["savedJob"] }).to eq([ nil, nil, nil ])
    own_source = create(:job, user: user, job_board_listing: source)
    own_url = create(:job, user: user, url: "https://example.com/apply?role=1&gclid=tracker#fragment")
    links = search.dig("data", "jobBoardSearch", "listings").map { |row| row["savedJob"] }
    expect(links).to eq([ { "id" => own_source.id }, { "id" => own_url.id }, nil ])
    expect(own_url.reload.job_board_listing_id).to be_nil
  end
end
