# Exercises explicit missing-summary generation and owner-scoped review through GraphQL.
require "rails_helper"

RSpec.describe "Summary generation mutations" do
  let(:user) { create(:user, summary: nil) }
  before do
    create(:experience, user: user, description: "Maintained payment APIs")
    allow(Shoryuken::Client).to receive(:queues).and_return(double(send_message: nil))
  end

  it "starts work and restores its state without saving profile text" do
    result = execute_graphql('mutation { startSummaryGeneration(input: {targetKind: "profile"}) { aiTask { id status } errors } }', user: user)
    expect(result["errors"]).to be_nil
    task = result.dig("data", "startSummaryGeneration", "aiTask")
    expect(task["status"]).to eq("QUEUED")
    query = execute_graphql('{ summaryGeneration(targetKind: "profile") { aiTask { id } stale } }', user: user)
    expect(query.dig("data", "summaryGeneration", "aiTask", "id")).to eq(task["id"])
    expect(user.reload.summary).to be_nil
  end
  it "accepts edited text explicitly and refuses another user's work" do
    task = SummaryGeneration::StartGenerationService.call(user: user, target_kind: "profile").value
    AiTasks::ApplyAiResultService.call(message: {"ai_task_id" => task.id, "status" => "completed", "result" => {"text" => "API engineer", "source_labels" => [task.input["sources"].first["label"]]}})
    mutation = %(mutation { acceptSummaryGeneration(input: {aiTaskId: "#{task.id}", text: "My reviewed summary"}) { aiTask { acceptedAt } errors } })
    other = execute_graphql(mutation, user: create(:user))
    expect(other.dig("data", "acceptSummaryGeneration", "errors")).to eq(["Record not found"])
    result = execute_graphql(mutation, user: user)
    expect(result.dig("data", "acceptSummaryGeneration", "errors")).to eq([])
    expect(user.reload.summary).to eq("My reviewed summary")
    expect(user.screened_fields).not_to include("summary")
  end

  it "does not disclose another profile's summary state" do
    other = create(:user)
    result = execute_graphql(%({ summaryGeneration(targetKind: "profile", targetId: "#{other.id}") { aiTask { id } stale } }), user: user)
    expect(result.fetch("errors").first.fetch("message")).to eq("Record not found")
  end

end
