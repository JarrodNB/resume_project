# Exercise shared search results through the persistence boundary, without provider HTTP.
require "rails_helper"

RSpec.describe JobBoard::SearchCatalogueService do
  let(:provider) { class_double(JobBoard::SearchCleanJobDataService) }
  let(:listing) { { "id" => 71, "title" => "Engineer", "locations" => [ { "country_code" => "US" } ] } }

  def search(**arguments)
    described_class.call(keyword: "  Software   Engineer ", provider: provider, **arguments)
  end

  it "persists and reuses the ordered page across equivalent whitespace searches" do
    expect(provider).to receive(:call).with(keyword: "software engineer", remote_only: false, experience_levels: [], cursor: nil)
      .once.and_return(ServiceResult.new(success: true, value: { listings: [ listing ], next_cursor: "opaque" }, errors: []))
    first = search
    second = described_class.call(keyword: "Software Engineer", provider: provider)
    expect(first).to be_success
    expect(second.value[:listings].map(&:provider_id)).to eq([ 71 ])
    expect(second.value[:listings].first.id).to eq(first.value[:listings].first.id)
    expect(second.value).to include(next_cursor: "opaque", stale: false, errors: [])
    expect(Job.count).to eq(0)
  end
  def successful_page(listings = [ listing ], next_cursor: nil)
    ServiceResult.new(success: true, value: { listings: listings, next_cursor: next_cursor }, errors: [])
  end

  it "bypasses a pre-normalization empty cache page without changing listing identity" do
    old_listing = create(:job_board_listing, provider_id: 71, payload: listing)
    digest = Digest::SHA256.hexdigest(JSON.generate([ "Software Engineer", false, nil ]))
    JobBoardSearchPage.create!(query_digest: digest, keyword: "Software Engineer", remote_only: false,
      listing_ids: [], next_cursor: "old-cursor", retrieved_at: Time.current)
    expect(provider).to receive(:call).and_return(successful_page([ listing.merge("location" => "Alpharetta, GA, US") ], next_cursor: "new-cursor"))
    result = search.value
    expect(result[:listings].map(&:id)).to eq([ old_listing.id ])
    expect(result[:next_cursor]).to eq("new-cursor")
    expect(JobBoardSearchPage.count).to eq(2)
  end

  it "does not fall back to a legacy page if the revised first fetch fails" do
    digest = Digest::SHA256.hexdigest(JSON.generate([ "Software Engineer", false, nil ]))
    JobBoardSearchPage.create!(query_digest: digest, keyword: "Software Engineer", remote_only: false,
      listing_ids: [], next_cursor: "old-cursor", retrieved_at: Time.current)
    allow(provider).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Unavailable" ]))
    result = search
    expect(result).not_to be_success
    expect(result.errors).to eq([ "Unavailable" ])
    expect(JobBoardSearchPage.count).to eq(1)
  end

  it "refreshes exactly at 24 hours and updates the same catalogue UUID" do
    travel_to(Time.utc(2026, 10, 19, 1)) do
      allow(provider).to receive(:call).and_return(successful_page)
      first = search.value
      travel 24.hours - 1.second
      expect(search.value[:retrieved_at]).to eq(first[:retrieved_at])
      expect(provider).to have_received(:call).once
      travel 1.second
      allow(provider).to receive(:call).and_return(successful_page([ listing.merge("title" => "Updated") ]))
      refreshed = search.value
      expect(refreshed[:listings].first.id).to eq(first[:listings].first.id)
      expect(refreshed[:listings].first.payload["title"]).to eq("Updated")
      expect(refreshed[:retrieved_at]).to eq(Time.current)
      expect(JobBoardListing.count).to eq(1)
    end
  end

  it "keeps the last successful page and timestamp on failure and retries next call" do
    allow(provider).to receive(:call).and_return(successful_page(next_cursor: "old-next"))
    first = search.value
    travel 24.hours + 1.second
    allow(provider).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Unavailable" ]))
    stale = search
    expect(stale).to be_success
    expect(stale.value).to include(stale: true, errors: [ "Unavailable" ], retrieved_at: first[:retrieved_at], next_cursor: "old-next")
    expect(stale.value[:listings].map(&:id)).to eq(first[:listings].map(&:id))
    expect(JobBoardSearchPage.first.retrieved_at).to eq(first[:retrieved_at])
    allow(provider).to receive(:call).and_return(successful_page([]))
    expect(search.value).to include(stale: false, errors: [], listings: [])
  end

  it "does not store a missing failed page" do
    allow(provider).to receive(:call).and_return(ServiceResult.new(success: false, value: nil, errors: [ "Quota exhausted" ]))
    expect(search.errors).to eq([ "Quota exhausted" ])
    expect(JobBoardSearchPage.count).to eq(0)
    expect(JobBoardListing.count).to eq(0)
  end

  it "caches an empty successful page" do
    expect(provider).to receive(:call).once.and_return(successful_page([]))
    expect(search.value[:listings]).to eq([])
    expect(search.value[:listings]).to eq([])
  end

  it "keeps remote and exact opaque cursor pages distinct" do
    allow(provider).to receive(:call).and_return(successful_page)
    search
    search(remote_only: true)
    search(cursor: "Token")
    search(cursor: "token")
    expect(JobBoardSearchPage.count).to eq(4)
    expect(provider).to have_received(:call).with(keyword: "software engineer", remote_only: false, experience_levels: [], cursor: "Token")
    expect(provider).to have_received(:call).exactly(4).times
  end

  it "shares ordered first and continuation pages across keyword casing while preserving punctuation" do
    phrase = '"software engineer" or rails+c++'
    [ nil, "NextToken" ].each do |cursor|
      expect(provider).to receive(:call).with(keyword: phrase, remote_only: false, experience_levels: [], cursor: cursor)
        .once.and_return(successful_page([ listing.merge("id" => 72), listing ], next_cursor: "NextToken"))
      results = [ '  "Software   Engineer" OR Rails+C++ ', phrase, phrase.upcase ].map do |keyword|
        described_class.call(keyword: keyword, cursor: cursor, provider: provider).value
      end
      expect(results.first[:listings].map(&:provider_id)).to eq([ 72, 71 ])
      expect(results.map { |page| [ page[:listings].map(&:id), page[:retrieved_at], page[:next_cursor] ] }.uniq.size).to eq(1)
    end
    expect(JobBoardSearchPage.count).to eq(2)
  end

  it "bypasses revision-one lowercase pages and their continuation chain" do
    old_listing = create(:job_board_listing, provider_id: 71, payload: listing)
    [ nil, "NextToken" ].each do |cursor|
      digest = Digest::SHA256.hexdigest(JSON.generate([ 1, "software engineer", false, cursor ]))
      JobBoardSearchPage.create!(query_digest: digest, keyword: "software engineer", remote_only: false,
        cursor: cursor, listing_ids: [ old_listing.id ], next_cursor: "OldToken", retrieved_at: Time.current)
      expect(provider).to receive(:call).with(keyword: "software engineer", remote_only: false, experience_levels: [], cursor: cursor)
        .and_return(successful_page([ listing.merge("id" => 72) ], next_cursor: "NewToken"))
      result = described_class.call(keyword: "software engineer", cursor: cursor, provider: provider).value
      expect(result[:listings].map(&:provider_id)).to eq([ 72 ])
      expect(result[:next_cursor]).to eq("NewToken")
    end
    expect(JobBoardSearchPage.count).to eq(4)
  end

  it "preserves provider order and deduplicates IDs across overlapping pages" do
    other = listing.merge("id" => 72)
    allow(provider).to receive(:call).and_return(successful_page([ other, listing, other ], next_cursor: "page2"))
    first = search.value
    expect(first[:listings].map(&:provider_id)).to eq([ 72, 71 ])
    allow(provider).to receive(:call).and_return(successful_page([ listing, other.merge("title" => "new") ]))
    expect(search(cursor: "page2").value[:listings].map(&:provider_id)).to eq([ 71, 72 ])
    expect(JobBoardListing.count).to eq(2)
    expect(JobBoardListing.find_by!(provider_id: 72).payload["title"]).to eq("new")
    expect(search.value[:listings].map(&:provider_id)).to eq([ 72, 71 ])
  end

  it "rejects invalid inputs before provider calls or persistence" do
    expect(provider).not_to receive(:call)
    [ nil, "", "x" * 201, "bad\nquery" ].each do |keyword|
      expect(described_class.call(keyword: keyword, provider: provider)).not_to be_success
    end
    expect(search(remote_only: "true")).not_to be_success
    expect(search(cursor: "")).not_to be_success
    expect(JobBoardSearchPage.count).to eq(0)
  end

  it "canonicalizes selected levels for cache identity and keeps distinct selections separate" do
    allow(provider).to receive(:call).and_return(successful_page)
    first = search(experience_levels: [ "SE", "EN", "SE" ])
    equivalent = search(experience_levels: [ "EN", "SE" ])
    expect(first.value).to eq(equivalent.value)
    search(experience_levels: [ "MI" ])
    search(experience_levels: [])
    search(experience_levels: [ "EN", "MI", "SE", "EX" ])
    search(experience_levels: [ "SE", "EN" ], cursor: "next")
    expect(JobBoardSearchPage.count).to eq(5)
    expect(provider).to have_received(:call).with(keyword: "software engineer", remote_only: false,
      experience_levels: [ "EN", "SE" ], cursor: nil).once
    expect(provider).to have_received(:call).with(keyword: "software engineer", remote_only: false,
      experience_levels: [ "EN", "SE" ], cursor: "next").once
  end

  it "rejects malformed selected levels before provider calls or caching" do
    expect(provider).not_to receive(:call)
    [ nil, "EN", [ "unknown" ], [ nil ] ].each do |levels|
      expect(search(experience_levels: levels)).not_to be_success
    end
    expect(JobBoardSearchPage.count).to eq(0)
  end

  it "enforces provider and page identity uniqueness in the database" do
    allow(provider).to receive(:call).and_return(successful_page)
    search
    row = JobBoardListing.first
    expect { JobBoardListing.transaction(requires_new: true) { row.dup.save! } }.to raise_error(ActiveRecord::RecordNotUnique)
    page = JobBoardSearchPage.first
    expect { JobBoardSearchPage.transaction(requires_new: true) { page.dup.save! } }.to raise_error(ActiveRecord::RecordNotUnique)
  end
end
