# Exercise private draft/confirmed preference revisions through the public schema.
require "rails_helper"

RSpec.describe "Next-job preferences" do
  let(:user) { create(:user) }
  let(:fields) { "version confirmedRevision draftCriteria { id text priority } confirmedCriteria { id text priority }" }

  def read(owner = user)
    execute_graphql("query { jobPreferences { #{fields} } }", user: owner)
  end

  def save(criteria, version: 0, owner: user)
    execute_graphql(<<~GQL, user: owner, variables: { criteria: criteria, version: version })
      mutation($criteria: [JobPreferenceCriterionInput!]!, $version: Int!) {
        saveJobPreferenceDraft(input: { criteria: $criteria, expectedVersion: $version }) {
          profile { #{fields} } errors
        }
      }
    GQL
  end

  def confirm(version, owner: user)
    execute_graphql(<<~GQL, user: owner, variables: { version: version })
      mutation($version: Int!) {
        confirmJobPreferences(input: { expectedVersion: $version }) {
          profile { #{fields} } errors
        }
      }
    GQL
  end

  it "starts with an empty private profile" do
    expect(read.dig("data", "jobPreferences")).to include("version" => 0, "confirmedRevision" => 0,
      "draftCriteria" => [], "confirmedCriteria" => [])
  end

  it "saves a private draft, confirms it, and preserves the confirmed revision during later edits" do
    saved = save([ { text: "Fully remote", priority: "must_have" } ]).dig("data", "saveJobPreferenceDraft")
    expect(saved).to include("errors" => [])
    draft = saved.fetch("profile")
    expect(draft).to include("version" => 1, "confirmedRevision" => 0, "confirmedCriteria" => [])
    criterion = draft.fetch("draftCriteria").first
    expect(criterion).to include("text" => "Fully remote", "priority" => "must_have")
    confirmed = confirm(1).dig("data", "confirmJobPreferences", "profile")
    expect(confirmed).to include("version" => 2, "confirmedRevision" => 2, "confirmedCriteria" => [ criterion ])
    save([ criterion.merge("text" => "Hybrid is okay", "priority" => "nice_to_have") ], version: 2)
    expect(read.dig("data", "jobPreferences")).to include("version" => 3, "confirmedRevision" => 2,
      "confirmedCriteria" => [ criterion ])
    expect(read(create(:user)).dig("data", "jobPreferences", "draftCriteria")).to eq([])
  end

  it "rejects stale saves and confirmations without losing a newer draft" do
    save([ { text: "Remote", priority: "must_have" } ])
    expect(confirm(0).dig("data", "confirmJobPreferences", "errors")).to include(JobPreferences::UpdateProfileService::STALE_MESSAGE)
    stale = save([ { text: "Stale", priority: "must_have" } ])
    expect(stale.dig("data", "saveJobPreferenceDraft", "errors")).to include(JobPreferences::UpdateProfileService::STALE_MESSAGE)
    expect(read.dig("data", "jobPreferences", "draftCriteria").first["text"]).to eq("Remote")
  end

  it "rejects invalid, excessive, duplicated, and another owner's criterion identities" do
    [ [ { text: " ", priority: "must_have" } ], [ { text: "x" * 501, priority: "must_have" } ],
      [ { text: "Remote", priority: "whatever" } ], Array.new(11) { { text: "Remote", priority: "must_have" } } ].each do |criteria|
      expect(save(criteria).dig("data", "saveJobPreferenceDraft", "errors")).not_to be_empty
    end
    saved = save([ { text: "Remote", priority: "must_have" } ]).dig("data", "saveJobPreferenceDraft", "profile", "draftCriteria")
    expect(save(saved * 2, version: 1).dig("data", "saveJobPreferenceDraft", "errors")).not_to be_empty
    other = create(:user)
    expect(save(saved, owner: other).dig("data", "saveJobPreferenceDraft", "errors")).not_to be_empty
    expect(other.reload.job_preference_profile).to be_nil
  end

  it "clears private preference text with a monotonic revision and supports an empty confirmed summary" do
    save([ { text: "Remote", priority: "must_have" } ])
    confirm(1)
    cleared = execute_graphql(<<~GQL, user: user)
      mutation { clearJobPreferences(input: {expectedVersion: 2}) { profile { #{fields} } errors } }
    GQL
    expect(cleared.dig("data", "clearJobPreferences", "profile")).to include("version" => 3,
      "confirmedRevision" => 3, "draftCriteria" => [], "confirmedCriteria" => [])
    expect(save([], version: 0).dig("data", "saveJobPreferenceDraft", "errors")).not_to be_empty
    save([], version: 3)
    expect(confirm(4).dig("data", "confirmJobPreferences", "profile", "confirmedCriteria")).to eq([])
    expect(user.jobs.count).to eq(0)
    expect(JobBoardListing.count).to eq(0)
  end
end
