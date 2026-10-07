# Description: A request body over 8 MB is refused before the app parses it, whether or not
# Content-Length says so.
require "rails_helper"

RSpec.describe MaxRequestBody do
  it "returns a JSON 413 naming the size" do
    app = described_class.new(->(_) { [ 200, {}, [ "ok" ] ] })

    status, _headers, body = app.call("CONTENT_LENGTH" => (described_class::MAX_BYTES + 1).to_s)

    expect(status).to eq(413)
    expect(JSON.parse(body.first).dig("errors", 0, "message")).to eq(TextLimits::REQUEST_TOO_LARGE)
  end

  it "continues when the body is within the cap" do
    app = described_class.new(->(_) { [ 200, {}, [ "ok" ] ] })

    status, _headers, body = app.call("CONTENT_LENGTH" => "12")

    expect(status).to eq(200)
    expect(body).to eq([ "ok" ])
  end

  it "returns a JSON 413 when a body with no Content-Length exceeds the cap" do
    app = described_class.new(lambda { |env|
      env["rack.input"].read
      [ 200, {}, [ "ok" ] ]
    })

    status, _headers, body = app.call("rack.input" => StringIO.new("a" * (described_class::MAX_BYTES + 1)))

    expect(status).to eq(413)
    expect(JSON.parse(body.first).dig("errors", 0, "message")).to eq(TextLimits::REQUEST_TOO_LARGE)
  end

  it "lets the app read a body that has no Content-Length and is within the cap" do
    seen = nil
    app = described_class.new(lambda { |env|
      seen = env["rack.input"].read
      [ 200, {}, [ "ok" ] ]
    })

    status, = app.call("rack.input" => StringIO.new("hello"))

    expect(status).to eq(200)
    expect(seen).to eq("hello")
  end
end
