# GraphQL fields can contain private career and chat text under arbitrary argument
# names. Filter the operation and variable envelope before HTTP or Cable logging.
require "rails_helper"

RSpec.describe "GraphQL parameter privacy" do
  let(:filter) { ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters) }

  it "redacts private inline literals and JSON variables" do
    payload = { "query" => 'mutation { sendChatMessage(message: "private-inline-text") { errors } }',
      "variables" => { "input" => { "summary" => "private-career-text", "message" => "private-chat-text" } },
      "operationName" => "SendChat" }
    filtered = filter.filter(payload)
    expect(filtered).to include("query" => "[FILTERED]", "variables" => "[FILTERED]", "operationName" => "SendChat")
    expect(filtered.to_s).not_to include("private-")
  end

  it "redacts GraphQL multipart operations and string-encoded variables" do
    payload = { "operations" => '{"query":"private-inline-text","variables":{"text":"private-upload-text"}}',
      "variables" => '{"text":"private-string-variables"}' }
    expect(filter.filter(payload).to_s).not_to include("private-")
  end
end
