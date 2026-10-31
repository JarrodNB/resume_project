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
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "text" => "API engineer", "source_labels" => [ task.input["source_references"].first["label"] ] } })
    mutation = %(mutation { acceptSummaryGeneration(input: {aiTaskId: "#{task.id}", text: "My reviewed summary"}) { aiTask { acceptedAt } errors } })
    other = execute_graphql(mutation, user: create(:user))
    expect(other.dig("data", "acceptSummaryGeneration", "errors")).to eq([ "Record not found" ])
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

  it "generates and accepts an orphan saved resume without modifying the profile" do
    resume = create(:resume, user: user, include_summary: false)
    create(:resume_section, resume: resume, section_type: "skills", content: { "items" => [ { "name" => "Ruby" } ] })
    resume.job.destroy!
    result = execute_graphql(%(mutation { startSummaryGeneration(input: {targetKind: "resume", targetId: "#{resume.id}"}) { aiTask { id } errors } }), user: user)
    expect(result.dig("data", "startSummaryGeneration", "errors")).to eq([])
    task = user.ai_tasks.find(result.dig("data", "startSummaryGeneration", "aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "text" => "Ruby developer", "source_labels" => [ task.input["source_references"].first["label"] ] } })
    expect(AiTasks::DescribeTaskOutcomeService.destination_for(task: task, user: user, status: "completed")).to eq("/resumes/#{resume.id}")
    accepted = execute_graphql(%(mutation { acceptSummaryGeneration(input: {aiTaskId: "#{task.id}", text: "Reviewed Ruby developer"}) { aiTask { acceptedAt } errors } }), user: user)
    expect(accepted.dig("data", "acceptSummaryGeneration", "errors")).to eq([])
    expect(resume.sections.summary.sole.content["text"]).to eq("Reviewed Ruby developer")
    expect(resume.reload.include_summary).to be(false)
    expect(user.reload.summary).to be_nil
    Records::DestroyRecordService.call(record: resume)
    expect(AiTasks::DescribeTaskOutcomeService.destination_for(task: task, user: user, status: "completed")).to eq("/resumes")
  end

  it "does not disclose foreign resume generation state" do
    other = create(:resume)
    result = execute_graphql(%({ summaryGeneration(targetKind: "resume", targetId: "#{other.id}") { aiTask { id } stale } }), user: user)
    expect(result.fetch("errors").first.fetch("message")).to eq("Record not found")
    rejected = execute_graphql(%(mutation { startSummaryGeneration(input: {targetKind: "resume", targetId: "#{other.id}"}) { errors } }), user: user)
    expect(rejected.dig("data", "startSummaryGeneration", "errors")).to eq([ "Record not found" ])
  end
end
