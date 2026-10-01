# Description: Every query only returns the signed-in user's own records.
require "rails_helper"

RSpec.describe "Query scoping" do
  let(:user) { create(:user) }
  let(:other_user) { create(:user) }

  it "lists only the user's own jobs, optionally filtered by stage" do
    create(:job, user: user, title: "Mine", stage: "applied")
    create(:job, user: user, title: "Mine too")
    create(:job, user: other_user, title: "Theirs")

    all_jobs = execute_graphql("{ jobs { title } }", user: user)
    applied_jobs = execute_graphql("{ jobs(stage: APPLIED) { title } }", user: user)

    expect(all_jobs.dig("data", "jobs").map { _1["title"] }).to contain_exactly("Mine", "Mine too")
    expect(applied_jobs.dig("data", "jobs").map { _1["title"] }).to eq([ "Mine" ])
  end

  it "returns 'Record not found' for another user's job" do
    their_job = create(:job, user: other_user)

    result = execute_graphql("query($id: ID!) { job(id: $id) { title } }", user: user, variables: { id: their_job.id })

    expect(result["errors"].first["message"]).to eq("Record not found")
  end

  it "returns experiences with ordered highlights" do
    experience = create(:experience, user: user)
    create(:experience_highlight, experience: experience, content: "Second", position: 1)
    create(:experience_highlight, experience: experience, content: "First", position: 0)

    result = execute_graphql("{ experiences { company highlights { content } } }", user: user)

    expect(result.dig("data", "experiences", 0, "highlights").map { _1["content"] }).to eq([ "First", "Second" ])
  end
end
