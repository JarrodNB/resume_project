# Exercise individual AI editing through owned GraphQL operations and queued results.
require "rails_helper"

RSpec.describe "Career library AI editing" do
  let(:user) { create(:user) }
  let!(:role) { create(:experience, user: user, description: "Built services") }
  let!(:highlight) { create(:experience_highlight, experience: role, content: "Helped migrate services", position: 0) }
  let(:queue) { double("queue", send_message: nil) }

  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  def start_edit(id = highlight.id, owner = user)
    execute_graphql(<<~GQL, user: owner).dig("data", "startLibraryEdit")
      mutation { startLibraryEdit(input: {kind: "experience_highlight", recordId: "#{id}", feedback: "Make my contribution clearer"}) { aiTask { id status input } errors } }
    GQL
  end

  it "queues an owned individual target with only its role as context" do
    create(:experience, user: user)
    result = start_edit
    expect(result["errors"]).to eq([])
    expect(result["aiTask"]["status"]).to eq("QUEUED")
    input = result["aiTask"]["input"]
    expect(input.dig("target", "record_id")).to eq(highlight.id)
    expect(input.dig("library", "experiences").map { |item| item["id"] }).to eq([role.id])
    expect(queue).to have_received(:send_message).once
  end

  def complete_edit(task)
    AiTasks::ApplyAiResultService.call(message: {
      "ai_task_id" => task.id, "status" => "completed", "message_history" => [],
      "result" => { "text" => "Migrated the billing service with the platform team.", "color" => "yellow", "reason" => "Add the outcome if you know it." }
    })
  end

  def accept_edit(task, owner = user)
    execute_graphql(<<~GQL, user: owner).dig("data", "acceptLibraryEdit")
      mutation { acceptLibraryEdit(input: {aiTaskId: "#{task.id}"}) { aiTask { id acceptedAt } errors } }
    GQL
  end

  it "accepts only the selected highlight, keeping its identity, siblings and generated trust" do
    sibling = create(:experience_highlight, experience: role, content: "Other evidence", position: 1)
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(task)
    expect { expect(accept_edit(task)["errors"]).to eq([]) }.to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id)
    expect(highlight.reload.content).to eq("Migrated the billing service with the platform team.")
    expect(highlight.position).to eq(0)
    expect(highlight.screened_fields).to include("content")
    expect(sibling.reload.content).to eq("Other evidence")
    expect(role.reload.description).to eq("Built services")
    expect(task.reload.accepted_at).to be_present
    expect { accept_edit(task) }.not_to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob)
  end

  def continue_edit(task, feedback: "I handled the billing API", skip: false, owner: user)
    execute_graphql(<<~GQL, user: owner).dig("data", "startLibraryEdit")
      mutation { startLibraryEdit(input: {previousTaskId: "#{task.id}", feedback: #{feedback.to_json}, skip: #{skip}}) { aiTask { id status input } errors } }
    GQL
  end

  def discard_edit(task, owner = user)
    execute_graphql(<<~GQL, user: owner).dig("data", "discardLibraryEdit")
      mutation { discardLibraryEdit(input: {aiTaskId: "#{task.id}"}) { aiTask { id status } errors } }
    GQL
  end

  it "does not discard accepted history or queue another embedding on replay" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(task)
    accept_edit(task)
    expect(discard_edit(task)["errors"]).to eq([])
    expect(task.reload.status).to eq("completed")
    expect(task.accepted_at).to be_present
  end

  it "keeps feedback turns distinct, reuses duplicates, and ignores an older paused result" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    history = [ { "kind" => "response", "parts" => [] } ]
    message = { "ai_task_id" => task.id, "status" => "needs_user_input", "message_history" => history,
      "pending_questions" => [ { "id" => "question-1", "question" => "Which part did you handle?" } ] }
    AiTasks::ApplyAiResultService.call(message: message)
    child = continue_edit(task)
    expect(child["errors"]).to eq([])
    expect(child.dig("aiTask", "input", "question_id")).to eq("question-1")
    expect(child.dig("aiTask", "input")).not_to have_key("history")
    expect(AiTask.find(child.dig("aiTask", "id")).input["history"]).to eq(history)
    expect(continue_edit(task).dig("aiTask", "id")).to eq(child.dig("aiTask", "id"))
    expect(continue_edit(task, feedback: "Different feedback")["errors"]).not_to be_empty
    AiTasks::ApplyAiResultService.call(message: message.merge("pending_questions" => [ { "id" => "late", "question" => "An old retry" } ]))
    expect(task.reload.pending_questions.first["id"]).to eq("question-1")
    expect(task.status).to eq("needs_user_input")
    expect(accept_edit(task)["errors"]).not_to be_empty
  end

  it "does not accept stale or deleted targets and invalidates generated coverage on user edits" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(task)
    highlight.update!(content: "Newer user text")
    expect(accept_edit(task)["errors"]).to include("This entry changed. Start a new edit from its current text.")
    expect(highlight.reload.content).to eq("Newer user text")
    highlight.destroy!
    expect(accept_edit(task)["errors"]).to eq([ "Record not found" ])
  end

  it "reuses accepted generated text until an ordinary user edit changes it" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(task)
    accept_edit(task)
    edit = Experiences::UpdateExperienceService.call(experience: role, attributes: { description: "Manually revised role description" })
    expect(edit).to be_success
    # Highlight coverage is retained when only the role description changes.
    expect(highlight.reload.screened_fields).to include("content")
    Experiences::UpdateExperienceService.call(experience: role, attributes: {}, highlights: [ "Manually revised highlight" ])
    expect(role.reload.highlights.first.screened_fields).not_to include("content")
  end

  it "keeps the accepted assessment when an older section snapshot finishes afterward" do
    snapshot = CareerLibrary::ReviewSnapshot.build(user: user, section: "experience")
    review = create(:ai_task, user: user, task_type: "review_library_section", input: snapshot)
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(task)
    accept_edit(task)
    old_grades = snapshot["targets"].map { |target| target.except("label").merge("color" => "red", "reason" => "Old source") }
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => review.id, "status" => "completed", "result" => { "assessments" => old_grades } })
    state = CareerLibrary::ReviewStateService.call(user: user, section: "experience").value
    grade = state[:assessments].find { |item| item["record_id"] == highlight.id }
    expect(grade.slice("color", "stale")).to eq("color" => "yellow", "stale" => false)
  end

  it "keeps operations and saved history owner-scoped" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    other = create(:user)
    expect(start_edit(highlight.id, other)["errors"]).to eq([ "Record not found" ])
    expect(continue_edit(task, owner: other)["errors"]).to eq([ "Record not found" ])
    expect(accept_edit(task, other)["errors"]).to eq([ "Record not found" ])
    expect(discard_edit(task, other)["errors"]).to eq([ "Record not found" ])
    query = "query { libraryEdit(kind: \"experience_highlight\", recordId: \"#{highlight.id}\") { stale aiTask { id } } }"
    expect(execute_graphql(query, user: other)["errors"]).to be_present
  end

  it "retains the pending tool identity when retrying a failed answer turn" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    history = [ { "kind" => "response", "parts" => [] } ]
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "needs_user_input", "message_history" => history,
      "pending_questions" => [ { "id" => "question-retry", "question" => "Which part did you handle?" } ] })
    child = AiTask.find(continue_edit(task).dig("aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => child.id, "status" => "failed", "error_message" => "Screening unavailable" })
    retry_task = AiTask.find(continue_edit(child, feedback: "I migrated billing endpoints").dig("aiTask", "id"))
    expect(retry_task.input["question_id"]).to eq("question-retry")
    expect(retry_task.input["history"]).to eq(history)
  end

  it "discards without library changes and rejects malformed proposals" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    expect(discard_edit(task)["errors"]).to eq([])
    complete_edit(task)
    expect(task.reload.status).to eq("failed")
    expect(highlight.reload.content).to eq("Helped migrate services")
    newer = AiTask.find(start_edit.dig("aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => newer.id, "status" => "completed", "message_history" => [],
      "result" => { "text" => "x" * 1001, "color" => "green", "reason" => "Too long" } })
    expect(newer.reload.status).to eq("failed")
  end

  it "drops invalid paused history instead of persisting an unresumable payload" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "needs_user_input",
      "message_history" => { "invalid" => true }, "pending_questions" => [ { "id" => "q", "question" => "A question" } ] })
    expect(task.reload.status).to eq("failed")
    expect(task.message_history).to eq([])
    expect(task.pending_questions).to eq([])
  end
end
