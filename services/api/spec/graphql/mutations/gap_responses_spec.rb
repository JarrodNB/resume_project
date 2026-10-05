# Description: saveGapResponse and deleteLibraryFact, including ownership.
require "rails_helper"

RSpec.describe "Gap response mutations" do
  include ActiveJob::TestHelper

  let(:user) { create(:user) }
  let(:job) { create(:job, user: user) }
  let(:requirement) { "Experience with Kubernetes" }

  def save_response(body:, add_to_library:, job_id: job.id, as: user)
    execute_graphql(<<~GQL, user: as, variables: { jobId: job_id, requirement: requirement, body: body, addToLibrary: add_to_library })
      mutation($jobId: ID!, $requirement: String!, $body: String!, $addToLibrary: Boolean!) {
        saveGapResponse(input: { jobId: $jobId, requirement: $requirement, body: $body, addToLibrary: $addToLibrary }) {
          jobGapResponse { id requirement body libraryFact { id response } }
          errors
        }
      }
    GQL
  end

  it "saves an answer on the user's job and returns it" do
    result = save_response(body: "Used it at Acme", add_to_library: false)

    response = job.gap_responses.sole
    expect(result.dig("data", "saveGapResponse")).to eq(
      "jobGapResponse" => {
        "id" => response.id, "requirement" => requirement, "body" => "Used it at Acme", "libraryFact" => nil
      },
      "errors" => []
    )
  end

  it "returns the library fact when the answer is added to the career library" do
    result = save_response(body: "Used it at Acme", add_to_library: true)

    fact = user.library_facts.sole
    expect(result.dig("data", "saveGapResponse", "jobGapResponse", "libraryFact")).to eq(
      "id" => fact.id, "response" => "Used it at Acme"
    )
  end

  it "can't save an answer on another user's job" do
    result = save_response(body: "Used it at Acme", add_to_library: false, job_id: create(:job).id)

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(JobGapResponse.count).to eq(0)
  end

  it "job.gapResponses lists the answers" do
    response = create(:job_gap_response, job: job, requirement: requirement, body: "Used it at Acme")

    result = execute_graphql(<<~GQL, user: user, variables: { id: job.id })
      query($id: ID!) { job(id: $id) { gapResponses { id body } } }
    GQL

    expect(result.dig("data", "job", "gapResponses")).to eq([ { "id" => response.id, "body" => "Used it at Acme" } ])
  end

  it "deleteLibraryFact removes the fact, keeps the job answer, and queues an embedding sync" do
    fact = create(:library_fact, user: user, requirement: requirement, response: "Used it at Acme")
    response = create(:job_gap_response, job: job, requirement: requirement, library_fact: fact)

    expect {
      result = execute_graphql(<<~GQL, user: user, variables: { id: fact.id })
        mutation($id: ID!) { deleteLibraryFact(input: { id: $id }) { errors } }
      GQL
      expect(result.dig("data", "deleteLibraryFact")).to eq("errors" => [])
    }.to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id)

    expect(LibraryFact.exists?(fact.id)).to be(false)
    expect(response.reload.library_fact_id).to be_nil
  end

  it "can't delete another user's fact" do
    fact = create(:library_fact)

    result = execute_graphql(<<~GQL, user: user, variables: { id: fact.id })
      mutation($id: ID!) { deleteLibraryFact(input: { id: $id }) { errors } }
    GQL

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(LibraryFact.exists?(fact.id)).to be(true)
  end

  it "libraryFacts lists the user's facts" do
    fact = create(:library_fact, user: user)
    create(:library_fact)

    result = execute_graphql("{ libraryFacts { id requirement } }", user: user)

    expect(result.dig("data", "libraryFacts")).to eq([ { "id" => fact.id, "requirement" => fact.requirement } ])
  end
end
