# Description: saveGapResponse and deleteCareerContext, including ownership.
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
          jobGapResponse { id requirement body careerContext { id response } }
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
        "id" => response.id, "requirement" => requirement, "body" => "Used it at Acme", "careerContext" => nil
      },
      "errors" => []
    )
  end

  it "returns the library context when the answer is added to the career library" do
    result = save_response(body: "Used it at Acme", add_to_library: true)

    context = user.career_contexts.sole
    expect(result.dig("data", "saveGapResponse", "jobGapResponse", "careerContext")).to eq(
      "id" => context.id, "response" => "Used it at Acme"
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

  it "deleteCareerContext removes the context, keeps the job answer, and queues an embedding sync" do
    context = create(:career_context, user: user, requirement: requirement, response: "Used it at Acme")
    response = create(:job_gap_response, job: job, requirement: requirement, career_context: context)

    expect {
      result = execute_graphql(<<~GQL, user: user, variables: { id: context.id })
        mutation($id: ID!) { deleteCareerContext(input: { id: $id }) { errors } }
      GQL
      expect(result.dig("data", "deleteCareerContext")).to eq("errors" => [])
    }.to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id)

    expect(CareerContext.exists?(context.id)).to be(false)
    expect(response.reload.career_context_id).to be_nil
  end

  it "can't delete another user's context" do
    context = create(:career_context)

    result = execute_graphql(<<~GQL, user: user, variables: { id: context.id })
      mutation($id: ID!) { deleteCareerContext(input: { id: $id }) { errors } }
    GQL

    expect(result["errors"].first["message"]).to eq("Record not found")
    expect(CareerContext.exists?(context.id)).to be(true)
  end

  it "careerContexts lists the user's career_contexts" do
    context = create(:career_context, user: user)
    create(:career_context)

    result = execute_graphql("{ careerContexts { id requirement } }", user: user)

    expect(result.dig("data", "careerContexts")).to eq([ { "id" => context.id, "requirement" => context.requirement } ])
  end
end
