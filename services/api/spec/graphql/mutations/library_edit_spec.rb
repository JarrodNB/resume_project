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

  it "queues an owned individual target without saved source copies" do
    create(:experience, user: user)
    result = start_edit
    expect(result["errors"]).to eq([])
    expect(result["aiTask"]["status"]).to eq("QUEUED")
    input = result["aiTask"]["input"]
    expect(input.dig("target", "record_id")).to eq(highlight.id)
    expect(input["command_version"]).to eq(1)
    stored = AiTask.find(result["aiTask"]["id"]).input
    expect(stored.keys & %w[library original_text history targets]).to be_empty
    expect(stored.to_json).not_to include(highlight.content, role.description)
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
    expect(AiTask.find(child.dig("aiTask", "id")).input).not_to have_key("history")
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

  it "retains generated coverage when the user changes a neighboring bullet" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(task)
    accept_edit(task)
    generated = highlight.reload.content

    result = Experiences::UpdateExperienceService.call(experience: role, attributes: {},
      highlights: [ generated, "#{generated} Added by the user." ])

    expect(result).to be_success
    expect(role.reload.highlights.find_by!(content: generated).screened_fields).to include("content")
    expect(role.highlights.find_by!(content: "#{generated} Added by the user.").screened_fields).not_to include("content")
  end

  it "retains generated field and highlight coverage when merging into another role" do
    highlight_task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(highlight_task)
    accept_edit(highlight_task)
    payload = execute_graphql(<<~GQL, user: user).dig("data", "startLibraryEdit")
      mutation { startLibraryEdit(input: {kind: "experience", recordId: "#{role.id}"}) { aiTask { id } errors } }
    GQL
    description_task = AiTask.find(payload.dig("aiTask", "id"))
    complete_edit(description_task)
    accept_edit(description_task)
    target = create(:experience, user: user, description: nil)

    result = CareerLibrary::MergeLibraryRecordsService.call(target: target, source: role)

    expect(result).to be_success
    expect(target.reload.description).to eq(description_task.reload.result["text"])
    expect(target.screened_fields).to include("description")
    expect(target.highlights.find_by!(content: highlight_task.reload.result["text"]).screened_fields).to include("content")
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
    expect(retry_task.input).not_to have_key("history")
  end

  it "discards without library changes and rejects malformed proposals" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    expect(discard_edit(task)["errors"]).to eq([])
    expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
    expect(discard_edit(task)["errors"]).to eq([])
    expect(task.ai_task_outcomes.count).to eq(1)
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
  it "rejects moved highlights and changed neighboring context before acceptance" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    complete_edit(task)
    role.update!(description: "Updated role evidence")
    expect(accept_edit(task)["errors"]).to include("This entry changed. Start a new edit from its current text.")
    destination = create(:experience, user: user)
    highlight.update!(experience: destination)
    expect(accept_edit(task)["errors"]).to include("This entry changed. Start a new edit from its current text.")
    expect(highlight.reload.content).to eq("Helped migrate services")
  end

  it "caps the owned exchange at eight turns without enqueueing another child" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    7.times do
      complete_edit(task)
      task = AiTask.find(continue_edit(task).dig("aiTask", "id"))
    end
    complete_edit(task)
    expect(continue_edit(task)["errors"]).to include("This edit has reached its turn limit. Start a new edit.")
    expect(user.ai_tasks.improve_library_entry.count).to eq(8)
  end

  it "records only selected exact admission fingerprints on completed results" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    foreign = create(:experience_highlight)
    receipts = [highlight, foreign].map do |record|
      { "record_type" => "experience_highlight", "record_id" => record.id,
        "fingerprints" => { "content" => Screening::RecordApprovalsService.field_fingerprint(record.content) } }
    end
    Screening::RecordApprovalsService.call(user: user, ai_task: task, reports: receipts)
    expect(highlight.reload.screened_fields).to include("content")
    expect(foreign.reload.screened_fields).to be_empty
    highlight.update!(content: "New manual content", screened_fields: [])
    Screening::RecordApprovalsService.call(user: user, ai_task: task, reports: receipts)
    expect(highlight.reload.screened_fields).to be_empty
  end

  it "rejects a worker callback that copies source or user request history" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed",
      "message_history" => [{ "kind" => "request", "parts" => [{ "part_kind" => "user-prompt", "content" => "Copied saved source" }] }],
      "result" => { "text" => "Generated proposal", "color" => "yellow", "reason" => "Add detail" } })
    expect(task.reload.status).to eq("failed")
    expect(task.message_history).to eq([])
  end

  it "accepts only new generated fragments and output acknowledgements on linked turns" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    first = [{ "kind" => "response", "parts" => [{ "part_kind" => "tool-call", "tool_name" => "final_result",
      "tool_call_id" => "proposal-one", "args" => { "text" => "Generated first proposal" } }] }]
    proposal = { "text" => "Generated first proposal", "color" => "yellow", "reason" => "Add outcome" }
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed",
      "message_history" => first, "result" => proposal })
    child = AiTask.find(continue_edit(task, feedback: "Fresh canonical feedback").dig("aiTask", "id"))
    fragment = [{ "kind" => "request", "parts" => [{ "part_kind" => "tool-return", "tool_name" => "final_result",
      "tool_call_id" => "proposal-one", "content" => "Final result processed." }] },
      { "kind" => "response", "parts" => [{ "part_kind" => "tool-call", "tool_name" => "final_result",
        "tool_call_id" => "proposal-two", "args" => { "text" => "Generated second proposal" } }] }]
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => child.id, "status" => "completed",
      "message_history" => fragment, "result" => proposal.merge("text" => "Generated second proposal") })
    expect(child.reload.status).to eq("completed")
    expect(child.message_history).to eq(fragment)
    expect(task.reload.message_history).to eq(first)
    expect(child.message_history.to_json).not_to include("Generated first proposal", "Fresh canonical feedback", highlight.content)
    expect(child.input).not_to have_key("history")
  end

  it "does not persist a deferred user answer copied into a callback" do
    task = AiTask.find(start_edit.dig("aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed",
      "message_history" => [{ "kind" => "request", "parts" => [{ "part_kind" => "tool-return", "tool_name" => "ask_user",
        "tool_call_id" => "question-one", "content" => "Copied user answer" }] }],
      "result" => { "text" => "Generated proposal", "color" => "yellow", "reason" => "Add detail" } })
    expect(task.reload.status).to eq("failed")
    expect(task.message_history).to eq([])
  end

end
