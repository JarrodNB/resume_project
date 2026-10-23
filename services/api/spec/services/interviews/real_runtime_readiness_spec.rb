# Exercises the bounded readiness probe without an actual runtime or provider request.
require "rails_helper"

RSpec.describe Interviews::RealRuntimeReadiness do
  around do |example|
    saved = ENV.to_h.slice("INTERVIEW_SERVICE_SECRET", "INTERVIEW_REAL_RUNTIME_ORIGIN")
    ENV["INTERVIEW_SERVICE_SECRET"] = "synthetic-service-secret"
    ENV["INTERVIEW_REAL_RUNTIME_ORIGIN"] = "http://runtime:8000"
    example.run
  ensure
    %w[INTERVIEW_SERVICE_SECRET INTERVIEW_REAL_RUNTIME_ORIGIN].each { |key| ENV.delete(key) }
    ENV.update(saved)
  end

  it "does not follow redirects or admit a malformed/oversized readiness response" do
    response = instance_double(Net::HTTPResponse, code: "302")
    http = instance_double(Net::HTTP, "use_ssl=": nil, "open_timeout=": nil, "read_timeout=": nil, "write_timeout=": nil)
    allow(Net::HTTP).to receive(:new).with("runtime", 8000, nil).and_return(http)
    allow(http).to receive(:start).and_yield(http)
    allow(http).to receive(:request).and_yield(response)
    expect(described_class.ready?).to be(false)
    ENV["INTERVIEW_REAL_RUNTIME_ORIGIN"] = "http://user:secret@runtime:8000"
    expect(described_class.ready?).to be(false)
  end

  it "accepts only a small successful ready response" do
    response = instance_double(Net::HTTPResponse, code: "200")
    allow(response).to receive(:read_body).and_yield('{"ready":true}')
    http = instance_double(Net::HTTP, "use_ssl=": nil, "open_timeout=": nil, "read_timeout=": nil, "write_timeout=": nil)
    allow(Net::HTTP).to receive(:new).with("runtime", 8000, nil).and_return(http)
    allow(http).to receive(:start).and_yield(http)
    allow(http).to receive(:request).and_yield(response)
    expect(described_class.ready?).to be(true)
    allow(response).to receive(:read_body).and_yield("x" * 1025)
    expect(described_class.ready?).to be(false)
  end
end
