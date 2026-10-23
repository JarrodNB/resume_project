# Verifies private presigning audiences and the byte cap at the storage boundary.
require "rails_helper"

RSpec.describe Interviews::MediaStorage do
  it "signs browser and executor capabilities with their own reachable origins" do
    original = ENV.to_h.slice("S3_ENDPOINT_URL", "INTERVIEW_BROWSER_STORAGE_ORIGIN")
    ENV["S3_ENDPOINT_URL"] = "http://s3:9090"
    ENV["INTERVIEW_BROWSER_STORAGE_ORIGIN"] = "http://localhost:19090"
    internal = described_class.new.read_url(key: "interviews/sealed/example", expires_in: 30)
    public_url = described_class.new(browser: true).read_url(key: "interviews/sealed/example", expires_in: 30)
    expect(URI(internal).host).to eq("s3")
    expect(URI(public_url).host).to eq("localhost")
    expect(URI(public_url).port).to eq(19090)
    expect(URI.decode_www_form(URI(public_url).query).to_h["X-Amz-Expires"]).to eq("30")
  ensure
    %w[S3_ENDPOINT_URL INTERVIEW_BROWSER_STORAGE_ORIGIN].each { |key| ENV[key] = original[key] }
  end

  it "stops a streaming object above the configured cap despite forged metadata" do
    client = instance_double(Aws::S3::Client)
    allow(client).to receive(:get_object).and_yield("x" * described_class::MAX_BYTES).and_yield("x")
    expect { described_class.new(client: client).read("private") }.to raise_error(described_class::InvalidObject)
  end
end
