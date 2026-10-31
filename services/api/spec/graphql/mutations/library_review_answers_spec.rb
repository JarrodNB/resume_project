# Exercises review questions as owned, immutable sources for individual library proposals.
require "rails_helper"

RSpec.describe "Career library review answers" do
  let(:user) { create(:user) }
  let!(:role) { create(:experience, user: user, description: "Built services") }
  let!(:highlight) { create(:experience_highlight, experience: role, content: "Helped migrate services", position: 0) }
  let(:queue) { double("queue", send_message: nil) }
  let(:snapshot) { CareerLibrary::ReviewSnapshot.build(user: user, section: "experience") }
  let!(:review) do
    create(:ai_task, user: user, task_type: "review_library_section", status: "completed", input: snapshot,
      result: { "assessments" => snapshot["targets"].map { |target| target.except("label").merge("color" => "yellow", "reason" => "Explain your contribution.", "question" => "Which part did you migrate?") } })
  end
  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  def answer_review(answer = "I migrated the billing endpoints", review_id: review.id, record_id: highlight.id, owner: user, kind: "experience_highlight")
    execute_graphql(<<~GQL, user: owner).dig("data", "answerLibraryReview")
      mutation { answerLibraryReview(input: { reviewTaskId: "#{review_id}", kind: "#{kind}", recordId: "#{record_id}", answer: #{answer.to_json} }) { aiTask { id status input acceptedAt } errors } }
    GQL
  end

  it "queues a proposal using the exact saved question and selected record context" do
    result = answer_review
    expect(result).to be_present
    expect(result["errors"]).to eq([])
    task = AiTask.find(result.dig("aiTask", "id"))
    expect(task.task_type).to eq("improve_library_entry")
    expect(task.input["review_question"]).to eq("review_task_id" => review.id, "answers" => [{ "question_index" => 0, "answer" => "I migrated the billing endpoints" }])
    expect(task.input["feedback"]).to eq("")
    expect(task.input.dig("target", "record_id")).to eq(highlight.id)
    expect(task.input.keys & %w[library history original_text]).to be_empty
    expect(task.input.to_json).not_to include("Which part did you migrate?")
    expect(highlight.reload.content).to eq("Helped migrate services")
    expect(queue).to have_received(:send_message).once
  end
  it "uses the completed assessment origin when the newest section review failed" do
    failed = create(:ai_task, user: user, task_type: "review_library_section", input: snapshot, status: "failed")
    result = execute_graphql('query { libraryReview(section: "experience") { aiTask { id } assessments { recordId reviewTaskId question } } }', user: user).dig("data", "libraryReview")
    expect(result.dig("aiTask", "id")).to eq(failed.id)
    expect(result["assessments"].find { |item| item["recordId"] == highlight.id }["reviewTaskId"]).to eq(review.id)
    expect(answer_review["errors"]).to eq([])
  end

  it "reuses exact submissions, conflicts on different answers, and resumes the latest linked turn" do
    first = answer_review
    task = AiTask.find(first.dig("aiTask", "id"))
    expect(answer_review.dig("aiTask", "id")).to eq(task.id)
    expect(answer_review("A different answer")["errors"]).to include("This question already has an answer. Open its draft to revise it.")
    task.update!(status: "failed", error_message: "Temporary provider failure")
    retry_result = CareerLibrary::StartEditService.call(user: user, previous_task_id: task.id, feedback: "I migrated billing and updated tests")
    expect(retry_result).to be_success
    expect(retry_result.value.input["review_question"]).to eq("review_task_id" => review.id)
    expect(answer_review.dig("aiTask", "id")).to eq(retry_result.value.id)
    expect(queue).to have_received(:send_message).twice
  end

  it "rejects foreign reviews and targets, missing questions, and invalid answers" do
    other = create(:user)
    foreign = create(:experience_highlight)
    expect(answer_review(owner: other)["errors"]).to eq([ "Record not found" ])
    expect(answer_review(record_id: foreign.id)["errors"]).to eq([ "Record not found" ])
    expect(answer_review(" ")["errors"]).not_to be_empty
    expect(answer_review("x" * (TextLimits::PROSE + 1))["errors"]).not_to be_empty
    review.update!(result: { "assessments" => review.result["assessments"].map { |item| item.except("question") } })
    expect(answer_review["errors"]).to include("This question is no longer current. Review this section again.")
    expect(queue).not_to have_received(:send_message)
  end

  it "rejects obsolete questions after a newer completed review even when the source is unchanged" do
    create(:ai_task, user: user, task_type: "review_library_section", input: snapshot, status: "completed", result: review.result)
    expect(answer_review["errors"]).to include("This question is no longer current. Review this section again.")
    expect(queue).not_to have_received(:send_message)
  end

  it "rejects changed sibling context, moved highlights, and deleted targets" do
    sibling = create(:experience_highlight, experience: role, content: "New context", position: 1)
    expect(answer_review["errors"]).not_to be_empty
    sibling.destroy!
    destination = create(:experience, user: user)
    highlight.update!(experience: destination)
    expect(answer_review["errors"]).not_to be_empty
    highlight.destroy!
    expect(answer_review["errors"]).to eq([ "Record not found" ])
    expect(queue).not_to have_received(:send_message)
  end

  it "does not silently replace an independent active draft" do
    draft = CareerLibrary::StartEditService.call(user: user, kind: "experience_highlight", record_id: highlight.id).value
    expect(answer_review["errors"]).to include("An existing draft is open for this detail. Finish or discard it before answering the review question.")
    expect(CareerLibrary::EditCommand.latest(user: user, kind: "experience_highlight", record_id: highlight.id).id).to eq(draft.id)
    expect(queue).to have_received(:send_message).once
  end

  it "accepts only the proposal and retires its question even when text is unchanged" do
    review.update!(result: { "assessments" => review.result["assessments"].map { |item| item.merge("questions" => [item["question"], "How did you approach it?", "What changed afterward?"]) } })
    task = AiTask.find(answer_review.dig("aiTask", "id"))
    message = { "ai_task_id" => task.id, "status" => "completed", "message_history" => [],
      "result" => { "text" => highlight.content, "color" => "yellow", "reason" => "The answer is reflected in existing wording." } }
    AiTasks::ApplyAiResultService.call(message: message)
    expect(highlight.reload.content).to eq("Helped migrate services")
    expect { CareerLibrary::FinishEditService.call(user: user, ai_task_id: task.id) }.to have_enqueued_job(CareerLibrary::SyncLibraryEmbeddingsJob).with(user.id)
    grade = CareerLibrary::ReviewStateService.call(user: user, section: "experience").value[:assessments].find { |item| item["record_id"] == highlight.id }
    expect(grade["question"]).to be_nil
    expect(grade["questions"]).to eq([])
    expect(answer_review.dig("aiTask", "id")).to eq(task.id)
    AiTasks::ApplyAiResultService.call(message: message.merge("result" => message["result"].merge("text" => "Late result")))
    expect(task.reload.result["text"]).to eq(highlight.content)
    expect(queue).to have_received(:send_message).once
  end

  it "does not reopen discarded answers or enqueue new work" do
    review.update!(result: { "assessments" => review.result["assessments"].map { |item| item.merge("questions" => [item["question"], "How did you approach it?", "What changed afterward?"]) } })
    task = AiTask.find(answer_review.dig("aiTask", "id"))
    CareerLibrary::FinishEditService.call(user: user, ai_task_id: task.id, discard: true)
    grade = CareerLibrary::ReviewStateService.call(user: user, section: "experience").value[:assessments].find { |item| item["record_id"] == highlight.id }
    expect(grade["question"]).to be_nil
    expect(grade["questions"]).to eq([])
    expect(answer_review["errors"]).to include("This answer was discarded. Review this section again for a new question.")
    expect(queue).to have_received(:send_message).once
    expect(highlight.reload.content).to eq("Helped migrate services")
  end

  it "rejects a deferred question returned by a review-answer regeneration" do
    task = AiTask.find(answer_review.dig("aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "needs_user_input", "message_history" => [{ "kind" => "response", "parts" => [] }],
      "pending_questions" => [{ "id" => "unexpected", "question" => "Another question?" }] })
    expect(task.reload.status).to eq("failed")
    expect(task.pending_questions).to eq([])
  end

  it "regenerates each supported narrative while accepting only its selected field" do
    user.update!(summary: "Engineer with migration experience")
    project = create(:project, user: user, description: "Helped with a stock sheet")
    context = create(:career_context, user: user, requirement: "Inventory", response: "I maintained stock records")
    [["user", user, "summary", "summary"], ["experience", role, "experience", "description"],
      ["project", project, "projects", "description"], ["career_context", context, "career_contexts", "response"]].each do |kind, record, section, field|
      source = CareerLibrary::ReviewSnapshot.build(user: user, section: section)
      grades = source["targets"].map { |target| target.except("label").merge("color" => "yellow", "reason" => "Add detail", "question" => "What did you personally do?") }
      origin = create(:ai_task, user: user, task_type: "review_library_section", input: source, status: "completed", result: { "assessments" => grades })
      payload = answer_review("I updated the count sheet", review_id: origin.id, record_id: record.id, kind: kind)
      expect(payload["errors"]).to eq([])
      task = AiTask.find(payload.dig("aiTask", "id"))
      original = record.reload[field]
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "message_history" => [],
        "result" => { "text" => "Updated the count sheet.", "color" => "green", "reason" => "Concrete action." } })
      expect(record.reload[field]).to eq(original)
      expect(CareerLibrary::FinishEditService.call(user: user, ai_task_id: task.id)).to be_success
      expect(record.reload[field]).to eq("Updated the count sheet.")
    end
  end

  it "rejects acceptance when the reviewed source changes during regeneration" do
    task = AiTask.find(answer_review.dig("aiTask", "id"))
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "message_history" => [],
      "result" => { "text" => "Migrated billing endpoints.", "color" => "green", "reason" => "Concrete contribution." } })
    highlight.update!(content: "More recent user evidence")
    result = CareerLibrary::FinishEditService.call(user: user, ai_task_id: task.id)
    expect(result).not_to be_success
    expect(result.errors).to include("This entry changed. Start a new edit from its current text.")
    expect(highlight.reload.content).to eq("More recent user evidence")
  end

end
