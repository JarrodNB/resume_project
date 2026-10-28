# Description: Job mutations: create, move stage, archive (all linked records survive), ownership
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

  %w[archiveJob deleteJob].each do |operation|
    it "#{operation} retains the job and all linked data on repeated requests" do
      resume = create(:resume, user: user)
      job = resume.job
      job.update!(stage: "applied", applied_at: 1.day.ago)
      answer = create(:job_gap_response, job: job)
      task = create(:ai_task, user: user, subject: job)
      applied_at = job.applied_at
      query = "mutation($id: ID!) { #{operation}(input: { id: $id }) { job { id } errors } }"

      result = execute_graphql(query, user: user, variables: { id: job.id })
      expect(result.dig("data", operation, "errors")).to eq([])
      archived_at = job.reload.archived_at
      expect(archived_at).to be_present
      expect(job.stage).to eq("applied")
      expect(job.applied_at).to eq(applied_at)
      expect(resume.reload.job_id).to eq(job.id)
      expect(answer.reload.job_id).to eq(job.id)
      expect(task.reload.subject).to eq(job)

      travel_to(1.hour.from_now) do
        expect(execute_graphql(query, user: user, variables: { id: job.id }).dig("data", operation, "errors")).to eq([])
      end
      expect(job.reload.archived_at).to eq(archived_at)
    end

    it "#{operation} cannot archive another user's job or a missing job" do
      their_job = create(:job)
      [their_job.id, SecureRandom.uuid].each do |id|
        result = execute_graphql("mutation($id: ID!) { #{operation}(input: { id: $id }) { errors } }", user: user, variables: { id: id })
        expect(result.dig("errors", 0, "message")).to eq("Record not found")
      end
      expect(their_job.reload.archived_at).to be_nil
    end
  end
end
