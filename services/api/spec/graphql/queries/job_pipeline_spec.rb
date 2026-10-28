# Description: The jobPipeline query returns the signed-in user's jobs with suggested next steps.
require "rails_helper"

RSpec.describe "jobPipeline query" do
  let(:user) { create(:user) }
  let(:query) { "{ jobPipeline { nextStep job { id title } } }" }

  it "returns only the user's own jobs, newest first, with next steps" do
    applied = create(:job, user: user, title: "Applied", stage: "applied", created_at: 2.days.ago)
    comparing = create(:job, user: user, title: "Comparing", created_at: 1.day.ago)
    create(:ai_task, user: user, subject: comparing, task_type: "analyze_gaps", status: "queued")
    create(:job, user: create(:user), title: "Theirs")

    create(:job, user: user, archived_at: Time.current)
    result = execute_graphql(query, user: user)

    expect(result["errors"]).to be_nil
    expect(result.dig("data", "jobPipeline")).to eq([
      { "nextStep" => "COMPARISON_RUNNING", "job" => { "id" => comparing.id, "title" => "Comparing" } },
      { "nextStep" => "AWAITING_RESPONSE", "job" => { "id" => applied.id, "title" => "Applied" } }
    ])
  end

  it "requires a signed-in user" do
    result = execute_graphql(query, user: nil)

    expect(result["errors"].first["message"]).to eq("Authentication required")
  end
end
