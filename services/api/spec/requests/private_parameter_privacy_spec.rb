# Private text sent to the internal AI callbacks, and the sign-up name, must not reach request logs.
require "rails_helper"

RSpec.describe "Private parameter logging" do
  let(:filter) { ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters) }

  it "redacts chat reply context and summaries" do
    payload = { "reply" => "private-reply", "career_context" => { "text" => "private-context" },
      "career_contexts" => [ { "text" => "private-context-two" } ],
      "summary_update" => { "text" => "private-summary" }, "stage" => "visible-stage" }
    filtered = filter.filter(payload)
    expect(filtered.to_s).not_to include("private-")
    expect(filtered["stage"]).to eq("visible-stage")
  end

  it "redacts interview preparation role and questions" do
    payload = { "role" => { "title" => "private-role" }, "questions" => [ "private-question" ], "checkpoint" => { "note" => "private-checkpoint" } }
    expect(filter.filter(payload).to_s).not_to include("private-")
  end

  it "redacts the sign-up name but keeps harmless name-like keys" do
    payload = { "user" => { "name" => "Private Person" }, "operationName" => "SendChat" }
    filtered = filter.filter(payload)
    expect(filtered.to_s).not_to include("Private Person")
    expect(filtered["operationName"]).to eq("SendChat")
  end
end
