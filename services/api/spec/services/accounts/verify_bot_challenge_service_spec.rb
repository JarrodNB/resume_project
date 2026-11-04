# The Turnstile check accepts only what Cloudflare accepts, and refuses when it can't get an answer.
require "rails_helper"

RSpec.describe Accounts::VerifyBotChallengeService, :real_bot_challenge do
  let(:http) { instance_double(Net::HTTP) }
  let(:body) { { "success" => true } }
  let(:response) { instance_double(Net::HTTPResponse, code: "200", body: JSON.generate(body)) }

  before do
    allow(Net::HTTP).to receive(:new).and_return(http)
    allow(http).to receive_messages("use_ssl=" => nil, "open_timeout=" => nil, "read_timeout=" => nil, "write_timeout=" => nil, "max_retries=" => nil)
    allow(http).to receive(:request).and_return(response)
  end

  it "succeeds when Cloudflare accepts, sending the token and client IP" do
    expect(described_class.call(token: "browser-token", client_ip: "8.8.8.8")).to be_success
    expect(http).to have_received(:request) do |request|
      form = URI.decode_www_form(request.body).to_h
      expect(form).to include("response" => "browser-token", "remoteip" => "8.8.8.8")
      expect(form["secret"]).to be_present
    end
  end

  context "when Cloudflare refuses" do
    let(:body) { { "success" => false, "error-codes" => [ "invalid-input-response" ] } }

    it "asks the person to retry" do
      expect(described_class.call(token: "used-token").errors).to eq([ described_class::FAILED ])
    end
  end

  [ nil, "", [ "token" ], { "a" => "b" }, "x" * 2049 ].each do |token|
    it "refuses #{token.inspect[0, 20]} without calling Cloudflare" do
      expect(described_class.call(token: token).errors).to eq([ described_class::FAILED ])
      expect(http).not_to have_received(:request)
    end
  end

  [ Timeout::Error, SocketError, Errno::ECONNREFUSED, OpenSSL::SSL::SSLError ].each do |error|
    it "fails closed on #{error}" do
      allow(http).to receive(:request).and_raise(error)
      expect(described_class.call(token: "token").errors).to eq([ described_class::UNAVAILABLE ])
    end
  end

  it "fails closed on a server error or unreadable answer" do
    allow(response).to receive_messages(code: "500", body: "oops")
    expect(described_class.call(token: "token").errors).to eq([ described_class::UNAVAILABLE ])
    allow(response).to receive_messages(code: "200", body: "<html>")
    expect(described_class.call(token: "token").errors).to eq([ described_class::UNAVAILABLE ])
  end

  it "does not treat a truthy non-true value as success" do
    allow(response).to receive(:body).and_return(JSON.generate("success" => "true"))
    expect(described_class.call(token: "token")).not_to be_success
  end

  it "refuses in production without a secret rather than using the test secret" do
    allow(Rails.env).to receive(:production?).and_return(true)
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("TURNSTILE_SECRET_KEY").and_return(nil)
    expect(described_class.call(token: "token").errors).to eq([ described_class::UNAVAILABLE ])
    expect(http).not_to have_received(:request)
  end

  [ "1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA" ].each do |secret|
    it "refuses the configured test secret #{secret} in production without calling Cloudflare" do
      allow(Rails.env).to receive(:production?).and_return(true)
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("TURNSTILE_SECRET_KEY").and_return(secret)

      expect(described_class.call(token: "token").errors).to eq([ described_class::UNAVAILABLE ])
      expect(http).not_to have_received(:request)
    end
  end

  it "verifies tokens with a configured production secret" do
    allow(Rails.env).to receive(:production?).and_return(true)
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("TURNSTILE_SECRET_KEY").and_return("production-secret")

    expect(described_class.call(token: "token")).to be_success
    expect(http).to have_received(:request) do |request|
      expect(URI.decode_www_form(request.body).to_h["secret"]).to eq("production-secret")
    end
  end
end
