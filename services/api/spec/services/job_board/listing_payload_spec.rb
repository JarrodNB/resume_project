# Check admitted catalogue fields without loading Rails, a database or HTTP transport.
require "spec_helper"
require_relative "../../../app/services/job_board/listing_payload"

RSpec.describe JobBoard::ListingPayload do
  let(:listing) { { "id" => "42", "title" => "Engineer", "locations" => [ { "country_code" => "US", "city_name" => "Austin", "state_code" => "TX" } ] } }

  it "requires structured US evidence and a valid title and identity" do
    [ nil, {}, listing.merge("id" => 0), listing.merge("title" => " "), listing.merge("title" => "Engineer\n"),
      listing.merge("locations" => [], "location" => "United States"),
      listing.merge("locations" => [ { "country_code" => "CA" } ]) ].each do |raw|
      expect(described_class.call(raw)).to be_nil
    end
  end

  it "keeps only allowed typed fields and US locations without mutating the input" do
    raw = listing.merge("locations" => [ { "country_code" => "CA" }, *listing["locations"] ],
      "description" => nil, "company" => { "name" => "Team", "private" => "discard" },
      "has_remote" => false, "is_active" => "yes", "application_url" => "https://jobs.test/apply", "private" => "discard")
    original = Marshal.load(Marshal.dump(raw))
    result = described_class.call(raw)
    expect(result).to eq("id" => 42, "title" => "Engineer", "locations" => listing["locations"],
      "location" => "Austin, TX, US", "description" => nil, "company" => { "name" => "Team" },
      "has_remote" => false, "application_url" => "https://jobs.test/apply")
    expect(raw).to eq(original)
    expect(result).not_to have_key("salary_text")
  end

  it "does not pass credential-bearing, executable or malformed application URLs" do
    [ "https://user:password@jobs.test/apply", "javascript:alert(1)", "https://bad host", nil ].each do |url|
      expect(described_class.call(listing.merge("application_url" => url))["application_url"]).to be_nil
    end
  end

  it "accepts only positive integer identities or strings containing only digits" do
    [ 42, "42", "0042" ].each do |id|
      expect(described_class.call(listing.merge("id" => id))["id"]).to eq(42)
    end
    [ nil, 0, -1, 42.0, true, "0", "-42", "42.0", " 42", "42\n" ].each do |id|
      expect(described_class.call(listing.merge("id" => id))).to be_nil
    end
  end

  it "rejects malformed location collections and projects only confirmed US rows" do
    [ nil, "US", { "country_code" => "US" } ].each do |locations|
      expect(described_class.call(listing.merge("locations" => locations))).to be_nil
    end
    locations = [ nil, "US", { "country_code" => "CA" },
      { "country_code" => "US", "city_name" => "Austin", "private" => "discard" } ]
    expect(described_class.call(listing.merge("locations" => locations))["locations"])
      .to eq([ { "country_code" => "US", "city_name" => "Austin" } ])
  end
end
