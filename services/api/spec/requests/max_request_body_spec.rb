# Description: A request body over 8 MB is refused before the app parses it, whether or not
# Content-Length says so. Underlying reads stop at the byte limit before allocating
# the entire body, including a single very long line.
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


RSpec.describe BoundedInput do
  [ :read, :gets, :each ].each do |method|
    it "bounds the underlying #{method} read before buffering an oversized body" do
      source = StringIO.new("x" * 100)
      # A request for the whole body would allocate it before the size check.
      expect(source).to receive(method == :read ? :read : :gets).with(11).and_call_original
      bounded = described_class.new(source, 10)

      expect { method == :each ? bounded.each { |_| } : bounded.public_send(method) }
        .to raise_error(BoundedInput::TooLarge)
      expect(source.pos).to eq(11)
    end
  end

  it "caps explicit read sizes after prior reads" do
    source = StringIO.new("x" * 100)
    bounded = described_class.new(source, 10)
    expect(bounded.read(4)).to eq("xxxx")
    expect(source).to receive(:read).with(7).and_call_original
    expect { bounded.read(100) }.to raise_error(BoundedInput::TooLarge)
  end

  it "preserves legal reads, buffers, EOF, iteration and rewind" do
    bounded = described_class.new(StringIO.new("hi\nthere"), 8)
    expect(bounded.each.to_a).to eq([ "hi\n", "there" ])
    bounded.rewind
    buffer = +"old"
    expect(bounded.read(3, buffer)).to equal(buffer)
    expect(buffer).to eq("hi\n")
    expect(bounded.read).to eq("there")
    expect(bounded.read).to eq("")
    expect(bounded.read(1)).to be_nil
  end

  it "supports bounded line separators and caller lengths" do
    bounded = described_class.new(StringIO.new("a|bc|d"), 6)
    expect(bounded.gets("|", 2)).to eq("a|")
    expect(bounded.gets(1)).to eq("b")
    expect(bounded.gets("|", chomp: true)).to eq("c")
    expect(bounded.gets(nil)).to eq("d")
  end
end
