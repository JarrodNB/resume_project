# Exercises the owned job selection at the public start interface, excluding private sources.
require "rails_helper"

RSpec.describe "Saved-job spoken interview GraphQL" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  let(:job) { create(:job, user: user, title: "Laboratory technician", company: nil, description: "Maintain instruments.") }
  let(:mutation) do
    'mutation($jobId: ID!) { startInterviewDemo(input: {jobId: $jobId}) { interview { id jobContext { id title company description requirements responsibilities niceToHaves } } errors } }'
  end

  before do
    allow(Interviews::DemoAccess).to receive(:real_enabled?).and_return(true)
    allow(Interviews::RealRuntimeReadiness).to receive(:ready?).and_return(true)
  end

  it "starts owned job practice and exposes only its safe saved job context" do
    result = execute_graphql(mutation, user: user, variables: { jobId: job.id })
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "startInterviewDemo", "errors")).to eq([])
    expect(result.dig("data", "startInterviewDemo", "interview", "jobContext")).to include(
      "id" => job.id, "title" => job.title, "company" => nil, "description" => job.description)
    expect(Types::InterviewSessionType.fields).not_to include("frozenContext")
  end

  it "rejects missing or foreign job selection without creating interview work" do
    [ create(:job).id, SecureRandom.uuid ].each do |id|
      result = execute_graphql(mutation, user: user, variables: { jobId: id })
      expect(result.dig("errors", 0, "message")).to eq("Record not found")
    end
    expect(user.interview_sessions).to be_empty
  end
end
