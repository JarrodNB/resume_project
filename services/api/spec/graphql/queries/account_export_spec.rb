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
end
