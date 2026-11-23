# The data export includes only the signed-in user's own saved records and no secrets.
require "rails_helper"

RSpec.describe "accountExport query" do
  include GraphqlHelpers
  let(:query) { "{ accountExport }" }

  it "exports the user's profile, library and jobs without credentials or other users' data" do
    user = create(:user, name: "Ada", summary: "Builds reliable systems")
    experience = create(:experience, user: user, company: "Acme")
    create(:experience_highlight, experience: experience, content: "Cut deploy time in half")
    create(:job, user: user, title: "Staff Engineer")
    create(:job, user: create(:user), title: "Someone else's job")

    export = execute_graphql(query, user: user).dig("data", "accountExport")

    expect(export["account"]).to include("email" => user.email, "name" => "Ada", "summary" => "Builds reliable systems")
    expect(export.dig("career_library", "experiences", 0)).to include("company" => "Acme", "highlights" => [ "Cut deploy time in half" ])
    expect(export["jobs"].map { |job| job["title"] }).to eq([ "Staff Engineer" ])
    serialized = export.to_json
    expect(serialized).not_to include(user.encrypted_password)
    expect(serialized).not_to include("Someone else's job")
    expect(serialized).not_to include("screened_fields")
  end

  it "exports active and retired written questions with their private cues" do
    user = create(:user)
    set = user.interview_question_sets.create!(number: 1)
    set.questions.create!(position: 1, question_text: "Current?", answer_format: "carl", answer_drafts: { "car" => { "action" => "Private alternative" } }, memory_anchor: "Current cue")
    set.retired_questions.create!(position: nil, retired_at: Time.current, question_text: "Replaced?", answer_text: "Kept answer", memory_anchor: "Retired cue")
    exported = execute_graphql(query, user: user).dig("data", "accountExport", "interview_question_sets", 0, "questions")
    expect(exported.size).to eq(2)
    expect(exported.first).to include("memory_anchor" => "Current cue", "retired_at" => nil,
      "answer_format" => "carl", "answer_drafts" => { "car" => { "action" => "Private alternative" } })
    expect(exported.last).to include("memory_anchor" => "Retired cue", "answer_text" => "Kept answer")
    expect(exported.last["retired_at"]).to be_present
  end
end
