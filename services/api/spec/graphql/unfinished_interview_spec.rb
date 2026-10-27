# Finds the owner's unfinished preparation even when it falls outside recent history.
require "rails_helper"

RSpec.describe "Unfinished spoken interview GraphQL" do
  let(:user) { create(:user, summary: "I maintain laboratory equipment.") }
  let(:query) { '{ unfinishedInterviewSession { id status jobContext { title company } } }' }

  it "finds the actual owner-scoped start blocker outside the latest twenty sessions" do
    blocker = Interviews::StartPreparationService.call(user: user).value
    blocker.update!(created_at: 1.day.ago)
    21.times do
      user.interview_sessions.create!(status: "completed", execution_mode: "real",
        execution_config: Interviews::ExecutionConfiguration::PRESETS.fetch("real"), expires_at: 1.day.from_now)
    end
    result = execute_graphql(query, user: user)
    expect(result["errors"]).to be_nil
    expect(result.dig("data", "unfinishedInterviewSession")).to include("id" => blocker.id, "status" => "preparing")
    expect(execute_graphql(query, user: create(:user)).dig("data", "unfinishedInterviewSession")).to be_nil
  end

  it "matches admission eligibility and requires authentication" do
    blocker = Interviews::StartPreparationService.call(user: user).value
    %w[abandoned completed expired].each do |status|
      blocker.update!(status: status)
      expect(execute_graphql(query, user: user).dig("data", "unfinishedInterviewSession")).to be_nil
    end
    blocker.update!(status: "active", expires_at: 1.second.ago)
    expect(execute_graphql(query, user: user).dig("data", "unfinishedInterviewSession")).to be_nil
    blocker.update!(expires_at: 1.day.from_now, frozen_context: {})
    expect(execute_graphql(query, user: user).dig("data", "unfinishedInterviewSession")).to be_nil
    expect(execute_graphql(query, user: nil).dig("errors", 0, "message")).to eq("Authentication required")
  end

  it "releases a blocked job start only after an explicit owned abandon" do
    job = create(:job, user: user)
    blocker = Interviews::StartPreparationService.call(user: user).value
    expect(Interviews::StartPreparationService.call(user: user, job: job)).not_to be_success
    mutation = 'mutation($id: ID!) { abandonInterview(input: {interviewId: $id}) { errors } }'
    expect(execute_graphql(mutation, user: create(:user), variables: { id: blocker.id }).dig("errors", 0, "message")).to eq("Record not found")
    expect(execute_graphql(query, user: user).dig("data", "unfinishedInterviewSession", "id")).to eq(blocker.id)
    expect(execute_graphql(mutation, user: user, variables: { id: blocker.id }).dig("data", "abandonInterview", "errors")).to eq([])
    expect(execute_graphql(query, user: user).dig("data", "unfinishedInterviewSession")).to be_nil
    started = Interviews::StartPreparationService.call(user: user, job: job, setup: { question_count: 5, question_format: "technical" })
    expect(started).to be_success
    expect(started.value.job_id).to eq(job.id)
    expect(started.value.setup_config).to include("question_count" => 5, "question_format" => "technical")
    expect(job.reload.stage).to eq("unapplied")
  end
end
