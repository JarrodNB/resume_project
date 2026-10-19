# Exercise provider requests and responses without Rails, a database, or network access.
require "spec_helper"
require_relative "../../../app/services/service_result"
require_relative "../../../app/services/application_service"
require_relative "../../../app/services/job_board/search_clean_job_data_service"

RSpec.describe JobBoard::SearchCleanJobDataService do
  let(:http) { instance_double(Net::HTTP) }
  let(:listing) { { "id" => 42, "title" => "Engineer", "locations" => [ { "country_code" => "US" } ], "description" => "<p>Build things</p>" } }
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
      expect(URI.decode_www_form(URI(request.path).query).to_h).to eq("title" => "engineer", "location" => "US", "extra_fields" => "description", "remote" => "true", "cursor" => "previous+/=")
    end
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
end
