# Exercise the authenticated HTTP boundary without contacting the AI runtime.
require "rails_helper"
require "socket"

RSpec.describe AiExecutions::NudgeService do
  around do |example|
    original_origin = ENV["AI_HTTP_ORIGIN"]
    original_secret = ENV["INTERVIEW_SERVICE_SECRET"]
    ENV["INTERVIEW_SERVICE_SECRET"] = "capacity-test-secret"
    example.run
  ensure
    ENV["AI_HTTP_ORIGIN"] = original_origin
    ENV["INTERVIEW_SERVICE_SECRET"] = original_secret
    @server&.close
    @response_thread&.kill if @response_thread&.alive?
  end

  before { allow(described_class).to receive(:call).and_call_original }

  def request_response(status:, body:, delay_body: 0)
    @server = TCPServer.new("127.0.0.1", 0)
    ENV["AI_HTTP_ORIGIN"] = "http://127.0.0.1:#{@server.addr[1]}"
    @response_thread = Thread.new do
      socket = @server.accept
      headers = +""
      headers << socket.gets until headers.end_with?("\r\n\r\n")
      request_body = socket.read(headers[/content-length: (\d+)/i, 1].to_i)
      socket.write("HTTP/1.1 #{status}\r\nContent-Type: application/json\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n\r\n")
      sleep delay_body if delay_body.positive?
      socket.write(body)
      socket.close
      [ headers, JSON.parse(request_body) ]
    end
    result = described_class.call(feature: "interviews", operation_id: "owned-operation")
    headers, payload = @response_thread.value
    expect(headers).to include("POST /internal/executions", "Bearer capacity-test-secret")
    expect(payload).to eq("feature" => "interviews", "operation_id" => "owned-operation")
    result
  end

  it "distinguishes explicit capacity backpressure at the configured authenticated origin" do
    result = request_response(status: "503 Service Unavailable", body: '{"error":"busy"}')
    expect(result).to be_success
    expect(result.value).to eq(:busy)
  end

  it "reports acceptance separately from capacity pressure" do
    result = request_response(status: "202 Accepted", body: "{}")
    expect(result).to be_success
    expect(result.value).to eq(:accepted)
  end

  [ '{"error":"unavailable"}', "not json", "[]", "null", "{}", '{"error":"busy","unexpected":true}' ].each do |body|
    it "keeps unavailable or malformed 503 #{body.inspect} as a bounded delivery failure" do
      result = request_response(status: "503 Service Unavailable", body: body)
      expect(result).not_to be_success
      expect(result.errors).to eq([ "AI execution unavailable" ])
    end
  end

  [ "401 Unauthorized", "404 Not Found", "500 Internal Server Error", "302 Found" ].each do |status|
    it "does not treat #{status} as explicit capacity backpressure" do
      expect(request_response(status: status, body: '{"error":"busy"}')).not_to be_success
    end
  end

  [ "202 Accepted", "503 Service Unavailable" ].each do |status|
    it "bounds response bytes for #{status}" do
      expect(request_response(status: status, body: (" " * 1025) + '{"error":"busy"}')).not_to be_success
    end
  end

  it "keeps a refused local connection as a sanitized transport failure" do
    @server = TCPServer.new("127.0.0.1", 0)
    ENV["AI_HTTP_ORIGIN"] = "http://127.0.0.1:#{@server.addr[1]}"
    @server.close
    result = described_class.call(feature: "interviews", operation_id: "owned-operation")
    expect(result).not_to be_success
    expect(result.errors).to eq([ "AI execution unavailable" ])
  end

  it "does not wait for a stalled capacity response body" do
    result = request_response(status: "503 Service Unavailable", body: '{"error":"busy"}', delay_body: 0.8)
    expect(result).not_to be_success
    expect(result.errors).to eq([ "AI execution unavailable" ])
  end

  [ "http://credentials@example.test", "http://example.test/extra", "http://example.test?redirect=1", "file:///tmp/executions" ].each do |origin|
    it "rejects an invalid fixed origin #{origin.inspect}" do
      ENV["AI_HTTP_ORIGIN"] = origin
      result = described_class.call(feature: "interviews", operation_id: "owned-operation")
      expect(result).not_to be_success
      expect(result.errors).to eq([ "AI execution unavailable" ])
    end
  end

  it "requires the configured service credential" do
    ENV["INTERVIEW_SERVICE_SECRET"] = nil
    expect(described_class.call(feature: "interviews", operation_id: "owned-operation")).not_to be_success
  end
end
