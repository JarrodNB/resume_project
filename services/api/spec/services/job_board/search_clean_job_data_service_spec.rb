# Exercise provider requests and responses without Rails, a database, or network access.
require "spec_helper"
require_relative "../../../app/services/service_result"
require_relative "../../../app/services/application_service"
require_relative "../../../app/services/job_board/search_clean_job_data_service"

RSpec.describe JobBoard::SearchCleanJobDataService do
  let(:http) { instance_double(Net::HTTP) }
  let(:listing) { { "id" => 42, "title" => "Engineer", "locations" => [ { "country_code" => "US" } ], "description" => "<p>Build things</p>", "location" => "US" } }
  let(:body) { { "data" => [ listing ], "pagination" => { "limit" => 20, "next_page" => "next+/=" }, "meta" => {} } }

  def respond_with(code = "200", payload = body)
    response = instance_double(Net::HTTPResponse, code: code, body: JSON.generate(payload))
    allow(http).to receive(:request).and_return(response)
    response
  end

  def search(**arguments)
    described_class.call(keyword: " engineer ", api_key: "test-secret", **arguments)
  end

  before do
    allow(Net::HTTP).to receive(:new).and_return(http)
    allow(http).to receive(:use_ssl=)
    allow(http).to receive(:open_timeout=)
    allow(http).to receive(:read_timeout=)
    allow(http).to receive(:write_timeout=)
    allow(http).to receive(:max_retries=)
    respond_with
  end

  it "requests one authenticated US list page with descriptions and opaque pagination" do
    result = search(remote_only: true, cursor: "previous+/=")
    expect(result).to be_success
    expect(result.value).to eq(listings: [ listing ], next_cursor: "next+/=")
    expect(Net::HTTP).to have_received(:new).with("api.cleanjobdata.com", 443, nil)
    expect(http).to have_received(:request).once do |request|
      expect(request).to be_a(Net::HTTP::Get)
      expect(request["Authorization"]).to eq("Bearer test-secret")
      expect(URI.decode_www_form(URI(request.path).query).to_h).to eq("title" => "engineer", "country_id" => "233", "extra_fields" => "description", "remote" => "true", "cursor" => "previous+/=")
    end
  end
  it "sends a canonical multi-level filter and omits it when no levels are selected" do
    expect(search(experience_levels: [ "SE", "EN", "SE" ])).to be_success
    expect(http).to have_received(:request).with(have_attributes(path: include("experience_level=EN%2CSE")))
    expect(search(experience_levels: [])).to be_success
    expect(http).to have_received(:request).with(have_attributes(path: satisfy { |path| !path.include?("experience_level") }))
  end

  it "rejects unknown or malformed experience filters before HTTP" do
    [ nil, "EN", [ "UNKNOWN" ], [ nil ], [ "en" ] ].each do |levels|
      expect(search(experience_levels: levels)).not_to be_success
    end
    expect(http).not_to have_received(:request)
  end

  it "keeps only valid US-confirmed listings in provider order without inventing optional fields" do
    us = { "country_code" => "US", "display_label" => "Austin, TX, US" }
    other = { "country_code" => "CA", "display_label" => "Toronto" }
    body["data"] = [ nil, listing.merge("id" => 0), listing.merge("title" => " "),
      listing.merge("locations" => nil, "location" => "United States"),
      listing.merge("locations" => [ other ]),
      listing.merge("locations" => [ other, us ], "location" => "Global", "secret" => "discard"),
      { "id" => 43, "title" => "Designer", "locations" => [ us ] } ]
    respond_with
    result = search
    expect(result.value[:listings].map { |job| job["id"] }).to eq([ 42, 43 ])
    expect(result.value[:listings].first).to eq(listing.merge("locations" => [ us ], "location" => "Austin, TX, US"))
    expect(result.value[:listings].last).not_to have_key("description")
    expect(result.value[:listings].last).not_to have_key("company")
  end

  it "builds a display location from confirmed structured fields when labels are missing" do
    body["data"] = [ listing.merge("location" => "Original provider text", "locations" => [
      { "country_code" => "CA", "display_label" => "Toronto" },
      { "country_code" => "US", "city_name" => "Alpharetta", "state_code" => "GA" }
    ]) ]
    respond_with
    expect(search.value[:listings].first["location"]).to eq("Alpharetta, GA, US")
  end

  it "prefers usable US labels, deduplicates them, and ignores malformed optional values" do
    rows = [
      { "country_code" => "CA", "display_label" => "Toronto" },
      { "country_code" => "US", "display_label" => " Austin, TX, US ", "city_name" => "Wrong" },
      { "country_code" => "US", "display_label" => [], "city_name" => "Alpharetta", "state_code" => "GA" },
      { "country_code" => "US", "display_label" => "Austin, TX, US" },
      { "country_code" => "US", "city_name" => 9, "state_code" => [], "state_name" => "California" },
      { "country_code" => "US", "display_label" => false }
    ]
    body["data"] = [ listing.merge("locations" => rows, "location" => "Ignore original") ]
    respond_with
    normalized = search.value[:listings].first
    expect(normalized["location"]).to eq("Austin, TX, US; Alpharetta, GA, US; California, US")
    expect(normalized["locations"].map { |row| row["country_code"] }.uniq).to eq([ "US" ])
  end

  it "uses original text for country-only locations, otherwise keeps the confirmed country" do
    [ [ " Continental United States ", "Continental United States" ], [ " ", "US" ], [ [], "US" ] ].each do |original, expected|
      body["data"] = [ listing.merge("location" => original) ]
      respond_with
      expect(search.value[:listings].first["location"]).to eq(expected)
    end
  end

  it "accepts provider IDs serialized as numeric strings" do
    body["data"] = [ listing.merge("id" => "111990153") ]
    respond_with
    expect(search.value[:listings].first["id"]).to eq(111990153)
  end

  [ nil, "", " ", 3, [], "a" * 201, "bad\nquery" ].each do |keyword|
    it "rejects invalid keyword #{keyword.inspect} without HTTP" do
      expect(search(keyword: keyword)).not_to be_success
      expect(http).not_to have_received(:request)
    end
  end

  it "rejects missing credentials and invalid filters without HTTP" do
    [ { api_key: " " }, { api_key: "key\nheader" }, { remote_only: "true" }, { cursor: 5 }, { cursor: "" } ].each do |arguments|
      expect(search(**arguments)).not_to be_success
    end
    expect(http).not_to have_received(:request)
  end

  it "omits the remote and cursor parameters by default and disables implicit retries" do
    search
    expect(http).to have_received(:request) do |request|
      parameters = URI.decode_www_form(URI(request.path).query).to_h
      expect(parameters).not_to have_key("remote")
      expect(parameters).not_to have_key("cursor")
    end
    expect(http).to have_received(:open_timeout=).with(2)
    expect(http).to have_received(:read_timeout=).with(3)
    expect(http).to have_received(:write_timeout=).with(2)
    expect(http).to have_received(:max_retries=).with(0)
  end

  [ nil, [], {}, { "data" => [], "pagination" => {} },
    { "data" => {}, "pagination" => { "limit" => 20 } },
    { "data" => [], "pagination" => { "limit" => 20, "next_page" => 9 }, "meta" => {} } ].each do |payload|
    it "rejects malformed page #{payload.inspect}" do
      respond_with("200", payload)
      expect(search.errors).to eq([ "CleanJobData returned an invalid search page." ])
    end
  end

  it "uses the configured server key when no key override is supplied" do
    allow(ENV).to receive(:[]).with("CLEANJOBDATA_API_KEY").and_return("configured-key")
    expect(described_class.call(keyword: "engineer")).to be_success
    expect(http).to have_received(:request) { |request| expect(request["Authorization"]).to eq("Bearer configured-key") }
  end

  it "keeps explicit null optional values and discards malformed optional types" do
    body["data"] = [ listing.merge("description" => nil, "company" => nil, "published" => [], "salary_min" => "bad") ]
    respond_with
    job = search.value[:listings].first
    expect(job).to include("description" => nil, "company" => nil)
    expect(job).not_to have_key("published")
    expect(job).not_to have_key("salary_min")
  end

  it "accepts an empty terminal page with missing next cursor" do
    body["data"] = []
    body["pagination"].delete("next_page")
    respond_with
    expect(search.value).to eq(listings: [], next_cursor: nil)
  end

  it "controls a successful HTTP response without a body" do
    response = respond_with
    allow(response).to receive(:body).and_return(nil)
    expect(search.errors).to eq([ "CleanJobData returned an invalid search page." ])
  end

  it "keeps only import/display fields and replaces unsafe application URLs with nil" do
    body["data"] = [ listing.merge("application_url" => "javascript:alert(1)", "salary_min" => 100,
      "company" => { "name" => "Acme", "twitter_url" => "https://example.com" }) ]
    respond_with
    expect(search.value[:listings].first).to eq(listing.merge("application_url" => nil, "company" => { "name" => "Acme" }))
    [ "https://example.com/jobs?id=42", "http://example.com/jobs" ].each do |url|
      body["data"].first["application_url"] = url
      respond_with
      expect(search.value[:listings].first["application_url"]).to eq(url)
    end
  end

  it "controls invalid JSON without exposing the body" do
    response = respond_with
    allow(response).to receive(:body).and_return("test-secret invalid json")
    expect(search.errors).to eq([ "CleanJobData returned an invalid search page." ])
  end

  { "400" => "rejected this search", "401" => "authentication failed", "403" => "does not allow API access",
    "404" => "unavailable", "500" => "unavailable", "502" => "unavailable" }.each do |code, message|
    it "controls HTTP #{code} without leaking provider content or retrying" do
      respond_with(code, { "error" => "test-secret" })
      result = search
      expect(result).not_to be_success
      expect(result.errors.join).to include(message)
      expect(result.errors.join).not_to include("test-secret")
      expect(http).to have_received(:request).once
    end
  end

  [ Net::OpenTimeout, Net::ReadTimeout, SocketError, Errno::ECONNREFUSED, OpenSSL::SSL::SSLError, EOFError, Net::HTTPBadResponse, Net::ProtocolError ].each do |error|
    it "controls #{error} without automatic retry" do
      allow(http).to receive(:request).and_raise(error, "test-secret")
      expect(search.errors).to eq([ "CleanJobData is temporarily unavailable. Please retry." ])
      expect(http).to have_received(:request).once
    end
  end

  [ "Monthly request limit of 500 reached. Upgrade your plan.", "Unknown limit test-secret" ].each do |message|
    it "does not retry quota or unrecognized rate limits" do
      respond_with("429", { "error" => message })
      result = search
      expect(result).not_to be_success
      expect(result.errors.join).not_to include("test-secret")
      expect(http).to have_received(:request).once
    end
  end

  it "retries the documented per-second limit only once after a bounded wait" do
    limited = instance_double(Net::HTTPResponse, code: "429", body: JSON.generate("error" => "Too many requests. Please slow down and retry."))
    ok = instance_double(Net::HTTPResponse, code: "200", body: JSON.generate(body))
    allow(http).to receive(:request).and_return(limited, ok)
    allow_any_instance_of(described_class).to receive(:sleep).with(1)
    expect(search).to be_success
    expect(http).to have_received(:request).twice
    allow(http).to receive(:request).and_return(limited)
    expect(search.errors).to eq([ "CleanJobData is busy. Please retry shortly." ])
    expect(http).to have_received(:request).exactly(4).times
  end
  it "forwards every optional filter using provider parameter names" do
    result = search(filters: { max_age: "7d", city_id: 5391959, employment_types: %w[CONTRACT FULL_TIME CONTRACT],
      remote_type: "fully_remote", minimum_salary: 100000, include_undisclosed_salaries: false,
      company_name: "  Acme   Labs  ", sort_by: "relevance" })
    expect(result).to be_success
    expect(http).to have_received(:request) do |request|
      expect(URI.decode_www_form(URI(request.path).query).to_h).to include(
        "max_age" => "7d", "city_id" => "5391959", "country_id" => "233", "employment_type" => "FULL_TIME,CONTRACT",
        "remote" => "true", "remote_type" => "fully_remote", "salary" => "100000", "require_salary" => "true",
        "company_name" => "acme labs", "sort_by" => "relevance")
    end
  end

  it "includes undisclosed salaries unless explicitly excluded with a minimum" do
    search(filters: { minimum_salary: 100000, include_undisclosed_salaries: true, state_id: 5332921 })
    expect(http).to have_received(:request) do |request|
      parameters = URI.decode_www_form(URI(request.path).query).to_h
      expect(parameters).to include("salary" => "100000", "state_id" => "5332921")
      expect(parameters).not_to have_key("require_salary")
    end
  end

  it "rejects invalid optional filters without HTTP" do
    [ nil, { unknown: true }, { max_age: "1y" }, { city_id: -1 }, { city_id: 1, state_id: 2 },
      { city_id: "1" }, { state_id: 0 }, { remote_type: "onsite" }, { minimum_salary: 0 },
      { minimum_salary: 1.5 }, { minimum_salary: 1_000_000_001 }, { include_undisclosed_salaries: "false" },
      { company_name: "bad\nname" }, { company_name: "x" * 201 }, { employment_types: [ "bad" ] },
      { employment_types: "FULL_TIME" }, { sort_by: "salary" } ].each do |filters|
      expect(search(filters: filters)).not_to be_success
    end
    expect(http).not_to have_received(:request)
  end

  it "keeps salary and employment display fields without accepting malformed types" do
    body["data"] = [ listing.merge("employment_type" => "CONTRACT", "salary_text" => "$60 per hour", "salary_currency" => "USD") ]
    respond_with
    expect(search.value[:listings].first).to include("employment_type" => "CONTRACT", "salary_text" => "$60 per hour", "salary_currency" => "USD")
  end
end
