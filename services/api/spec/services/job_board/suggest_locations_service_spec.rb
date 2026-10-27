# Resolve provider suggestions without network requests or database persistence.
require "spec_helper"
require_relative "../../../app/services/service_result"
require_relative "../../../app/services/application_service"
require_relative "../../../app/services/job_board/suggest_locations_service"

RSpec.describe JobBoard::SuggestLocationsService do
  let(:http) { instance_double(Net::HTTP) }
  let(:city) { { "kind" => "city", "city_id" => 5391959, "country_code" => "US", "display_label" => "San Francisco, CA, US" } }
  let(:rows) { [ city ] }
  let(:response) { instance_double(Net::HTTPResponse, code: "200", body: JSON.generate(rows)) }
  before do
    allow(Net::HTTP).to receive(:new).and_return(http)
    allow(http).to receive_messages("use_ssl=" => nil, "open_timeout=" => nil, "read_timeout=" => nil, "write_timeout=" => nil, "max_retries=" => nil)
    allow(http).to receive(:request).and_return(response)
  end
  def suggest(**arguments)
    described_class.call(query: " San Fran ", api_key: "test-secret", **arguments)
  end

  it "requests city/state suggestions and returns only bounded unique US choices" do
    rows.concat([ city, city.merge("country_code" => "CA"), city.merge("kind" => "country"),
      city.merge("city_id" => nil), city.merge("display_label" => ""), nil,
      { "kind" => "state", "state_id" => 5332921, "country_code" => "US", "display_label" => "California, US" } ])
    allow(response).to receive(:body).and_return(JSON.generate(rows))
    expect(suggest.value).to eq(locations: [
      { kind: "city", provider_id: 5391959, label: "San Francisco, CA, US" },
      { kind: "state", provider_id: 5332921, label: "California, US" }
    ], errors: [])
    expect(http).to have_received(:request) do |request|
      expect(request["Authorization"]).to eq("Bearer test-secret")
      expect(URI.decode_www_form(URI(request.path).query).to_h).to eq("q" => "San Fran", "kinds" => "city,state", "limit" => "30")
    end
  end

  it "rejects malformed queries or missing configuration before HTTP" do
    [ nil, "", "x", "x" * 101, "bad\nquery" ].each do |query|
      expect(suggest(query: query)).not_to be_success
    end
    expect(suggest(api_key: "")).not_to be_success
    expect(http).not_to have_received(:request)
  end

  it "returns an empty success when no US locations match" do
    rows.clear
    allow(response).to receive(:body).and_return(JSON.generate(rows))
    expect(suggest.value).to eq(locations: [], errors: [])
  end

  it "controls HTTP, invalid payload and transport failures without exposing response text" do
    [ [ "429", "test-secret" ], [ "200", "test-secret" ], [ "200", "{}" ] ].each do |code, body|
      allow(response).to receive_messages(code: code, body: body)
      expect(suggest.errors).to eq([ described_class::UNAVAILABLE ])
    end
    allow(http).to receive(:request).and_raise(Net::ReadTimeout, "test-secret")
    expect(suggest.errors).to eq([ described_class::UNAVAILABLE ])
  end
end
