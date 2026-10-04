# Description: Job mutations: create, move stage, delete (tailored resumes survive), ownership
# checks, validation errors.
require "rails_helper"

RSpec.describe "Job mutations" do
  let(:user) { create(:user) }

  it "creates a job" do
    result = execute_graphql(<<~GQL, user: user)
      mutation {
        createJob(input: { attributes: { title: "AI Engineer", company: "Acme", requirements: ["Python"] } }) {
          job { title stage requirements }
          errors
        }
      }
    GQL

    payload = result.dig("data", "createJob")
    expect(payload["errors"]).to eq([])
    expect(payload["job"]).to eq("title" => "AI Engineer", "stage" => "UNAPPLIED", "requirements" => [ "Python" ])
  end

  it "returns validation errors instead of raising" do
    result = execute_graphql(<<~GQL, user: user)
      mutation { createJob(input: { attributes: { title: "No company" } }) { job { id } errors } }
    GQL

    payload = result.dig("data", "createJob")
    expect(payload["job"]).to be_nil
    expect(payload["errors"]).to include("Company can't be blank")
  end

  it "moves a job to a new stage" do
    job = create(:job, user: user)

    result = execute_graphql(<<~GQL, user: user, variables: { id: job.id })
      mutation($id: ID!) { moveJobToStage(input: { id: $id, stage: APPLIED }) { job { stage appliedAt } errors } }
    GQL

    expect(result.dig("data", "moveJobToStage", "job", "stage")).to eq("APPLIED")
    expect(result.dig("data", "moveJobToStage", "job", "appliedAt")).to be_present
  end

  it "keeps the job's tailored resumes editable after deleting it" do
    resume = create(:resume, user: user)

    result = execute_graphql(<<~GQL, user: user, variables: { id: resume.job_id })
      mutation($id: ID!) { deleteJob(input: { id: $id }) { job { id } errors } }
    GQL

    expect(result.dig("data", "deleteJob", "errors")).to eq([])
    resume.reload
    expect(resume.job).to be_nil
    expect(resume.update(title: "Renamed")).to be(true)
  end

  it "cannot delete another user's job" do
    their_job = create(:job)

    result = execute_graphql(<<~GQL, user: user, variables: { id: their_job.id })
      mutation($id: ID!) { deleteJob(input: { id: $id }) { job { id } errors } }
    GQL

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(Job.exists?(their_job.id)).to be(true)
  end
end
