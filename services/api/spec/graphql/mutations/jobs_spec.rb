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
      mutation { createJob(input: { attributes: { company: "Acme" } }) { job { id } errors } }
    GQL

    payload = result.dig("data", "createJob")
    expect(payload["job"]).to be_nil
    expect(payload["errors"]).to include("Title can't be blank")
  end

  it "returns validation errors when a requirement list is explicitly null" do
    result = execute_graphql(<<~GQL, user: user)
      mutation {
        createJob(input: { attributes: { title: "Engineer", requirements: null } }) {
          job { id }
          errors
        }
      }
    GQL

    payload = result.dig("data", "createJob")
    expect(payload["job"]).to be_nil
    expect(payload["errors"]).to include("Requirements must be a list")
    expect(Job.count).to eq(0)
  end

  it "leaves requirement lists unchanged when omitted and rejects null on update" do
    job = create(:job, user: user, nice_to_haves: [ "Communication" ])

    result = execute_graphql(<<~GQL, user: user, variables: { id: job.id })
      mutation($id: ID!) {
        updateJob(input: { id: $id, attributes: { niceToHaves: null } }) {
          job { id niceToHaves }
          errors
        }
      }
    GQL

    payload = result.dig("data", "updateJob")
    expect(payload["job"]).to be_nil
    expect(payload["errors"]).to include("Nice to haves must be a list")
    expect(job.reload.nice_to_haves).to eq([ "Communication" ])
  end

  it "creates, names, clears, and reads a job with an unknown company" do
    created = execute_graphql(<<~GQL, user: user)
      mutation { createJob(input: { attributes: { title: "Engineer", company: "  " } }) { job { id company } errors } }
    GQL
    payload = created.dig("data", "createJob")
    expect(payload["errors"]).to eq([])
    expect(payload["job"]["company"]).to be_nil
    job_id = payload["job"]["id"]

    [ "Acme", nil, "" ].each do |company|
      updated = execute_graphql(<<~GQL, user: user, variables: { id: job_id, company: company })
        mutation($id: ID!, $company: String) { updateJob(input: { id: $id, attributes: { company: $company } }) { job { company title } errors } }
      GQL
      expect(updated.dig("data", "updateJob", "errors")).to eq([])
      expect(updated.dig("data", "updateJob", "job")).to eq("title" => "Engineer", "company" => company.presence)
      expect(user.jobs.find(job_id).company).to eq(company.presence)
    end

    read = execute_graphql("query { jobs { company } }", user: user)
    expect(read.dig("data", "jobs")).to eq([ { "company" => nil } ])
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
