# Exercises optional review answers as one immutable, source-owned regeneration batch.
require "rails_helper"

RSpec.describe "Career library review answer batches" do
  let(:user) { create(:user) }
  let!(:role) { create(:experience, user: user, description: "Built services") }
  let!(:highlight) { create(:experience_highlight, experience: role, content: "Helped migrate services", position: 0) }
  let(:queue) { double("queue", send_message: nil) }
  let(:questions) { [ "Which part did you migrate?", "How did you check it?", "What changed afterward?" ] }
  let!(:review) do
    snapshot = CareerLibrary::ReviewSnapshot.build(user: user, section: "experience")
    create(:ai_task, user: user, task_type: "review_library_section", status: "completed", input: snapshot,
      result: { "assessments" => snapshot["targets"].map { |target| target.except("label").merge("color" => "yellow", "reason" => "Add evidence.", "questions" => questions, "question" => questions.first) } })
  end
  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  def answer_batch(answers, review_id: review.id, record_id: highlight.id, owner: user)
    execute_graphql(<<~GQL, user: owner, variables: { reviewId: review_id, recordId: record_id, answers: answers }).dig("data", "answerLibraryReview")
      mutation($reviewId: ID!, $recordId: ID!, $answers: [LibraryReviewAnswerInput!]!) {
        answerLibraryReview(input: {reviewTaskId: $reviewId, kind: "experience_highlight", recordId: $recordId, answers: $answers}) {
          aiTask { id status input } errors
        }
      }
    GQL
  end

  it "queues one paired batch when the first answer is blank" do
    payload = answer_batch([{ questionIndex: 0, answer: " " }, { questionIndex: 2, answer: " Colleagues could find billing records. " }, { questionIndex: 1, answer: "I updated integration tests." }])
    expect(payload).to be_present
    expect(payload["errors"]).to eq([])
    task = AiTask.find(payload.dig("aiTask", "id"))
    expect(task.input["feedback"]).to eq("")
    expect(task.input["review_question"]).to eq("review_task_id" => review.id, "answers" => [
      { "question_index" => 1, "question" => questions[1], "answer" => "I updated integration tests." },
      { "question_index" => 2, "question" => questions[2], "answer" => "Colleagues could find billing records." }
    ])
    expect(highlight.reload.content).to eq("Helped migrate services")
    expect(queue).to have_received(:send_message).once
  end

  it "canonicalizes reordered answers, ignores blank fields, and conflicts on changed answers" do
    answers = [{ questionIndex: 0, answer: "Billing" }, { questionIndex: 2, answer: "Easier reconciliation" }]
    first = answer_batch(answers)
    expect(first["errors"]).to eq([])
    same = answer_batch([{ questionIndex: 2, answer: " Easier reconciliation " }, { questionIndex: 1, answer: "\n" }, { questionIndex: 0, answer: "Billing" }])
    expect(same.dig("aiTask", "id")).to eq(first.dig("aiTask", "id"))
    expect(answer_batch([{ questionIndex: 0, answer: "Billing" }, { questionIndex: 2, answer: "Different outcome" }])["errors"]).not_to be_empty
    expect(queue).to have_received(:send_message).once
  end

  it "requires one nonblank answer and rejects invalid or duplicate indices before enqueue" do
    invalid = [[], [{ questionIndex: 0, answer: " " }, { questionIndex: 1, answer: "\n" }],
      [{ questionIndex: -1, answer: "A" }], [{ questionIndex: 3, answer: "A" }],
      [{ questionIndex: 1, answer: "A" }, { questionIndex: 1, answer: "B" }],
      (0..3).map { |index| { questionIndex: index, answer: "A" } },
      [{ questionIndex: 0, answer: "x" * (TextLimits::PROSE + 1) }]]
    invalid.each { |answers| expect(answer_batch(answers)["errors"]).not_to be_empty }
    review.update!(result: { "assessments" => review.result["assessments"].map { |item| item.merge("questions" => questions.first(1)) } })
    expect(answer_batch([{ questionIndex: 0, answer: "A" }, { questionIndex: 2, answer: " " }])["errors"]).not_to be_empty
    expect(queue).not_to have_received(:send_message)
  end

  it "allows three independent prose-sized answers without flattening feedback" do
    payload = answer_batch((0..2).map { |index| { questionIndex: index, answer: (index + 1).to_s * TextLimits::PROSE } })
    expect(payload["errors"]).to eq([])
    pairs = payload.dig("aiTask", "input", "review_question", "answers")
    expect(pairs.map { |item| item["answer"].length }).to eq([4000, 4000, 4000])
    expect(payload.dig("aiTask", "input", "feedback")).to eq("")
    expect(queue).to have_received(:send_message).once
  end

  it "retries a failed batch without inventing new feedback and retains every pair in later turns" do
    root = AiTask.find(answer_batch([{ questionIndex: 0, answer: "Billing endpoints" }, { questionIndex: 2, answer: "Less repeated work" }]).dig("aiTask", "id"))
    root.update!(status: "failed", error_message: "Temporary provider failure")
    retry_result = CareerLibrary::StartEditService.call(user: user, previous_task_id: root.id)
    expect(retry_result).to be_success
    retried = retry_result.value
    expect(retried.input["feedback"]).to eq("")
    expect(retried.input["skip"]).to be(false)
    expect(retried.input["review_question"]).to eq(root.input["review_question"])
    expect(CareerLibrary::StartEditService.call(user: user, previous_task_id: root.id).value.id).to eq(retried.id)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => retried.id, "status" => "completed", "message_history" => [],
      "result" => { "text" => "Migrated billing endpoints to reduce repeated work.", "color" => "green", "reason" => "Specific contribution." } })
    expect(CareerLibrary::StartEditService.call(user: user, previous_task_id: retried.id)).not_to be_success
    followup = CareerLibrary::StartEditService.call(user: user, previous_task_id: retried.id, feedback: "Keep the outcome")
    expect(followup).to be_success
    expect(followup.value.input["review_question"]).to eq(root.input["review_question"])
    expect(queue).to have_received(:send_message).exactly(3).times
  end

  it "retains current-question ownership and unrelated draft protections for batches" do
    answer = [{ questionIndex: 1, answer: "Integration checks" }]
    expect(answer_batch(answer, owner: create(:user))["errors"]).to eq(["Record not found"])
    expect(answer_batch(answer, record_id: create(:experience_highlight).id)["errors"]).to eq(["Record not found"])
    draft = CareerLibrary::StartEditService.call(user: user, kind: "experience_highlight", record_id: highlight.id).value
    expect(answer_batch(answer)["errors"]).not_to be_empty
    expect(CareerLibrary::EditSnapshot.latest(user: user, kind: "experience_highlight", record_id: highlight.id).id).to eq(draft.id)
    CareerLibrary::FinishEditService.call(user: user, ai_task_id: draft.id, discard: true)
    highlight.update!(content: "Newer evidence")
    expect(answer_batch(answer)["errors"]).not_to be_empty
    expect(queue).to have_received(:send_message).once
  end


  it "accepts a generated batch proposal once and retires all questions without changing sibling fields" do
    task = AiTask.find(answer_batch([{ questionIndex: 1, answer: "Integration tests" }, { questionIndex: 2, answer: "Fewer errors" }]).dig("aiTask", "id"))
    message = { "ai_task_id" => task.id, "status" => "completed", "message_history" => [],
      "result" => { "text" => "Updated integration tests to reduce errors.", "color" => "green", "reason" => "Concrete evidence." } }
    AiTasks::ApplyAiResultService.call(message: message)
    expect(highlight.reload.content).to eq("Helped migrate services")
    expect(CareerLibrary::FinishEditService.call(user: user, ai_task_id: task.id)).to be_success
    expect(highlight.reload.content).to eq("Updated integration tests to reduce errors.")
    expect(role.reload.description).to eq("Built services")
    grade = CareerLibrary::ReviewStateService.call(user: user, section: "experience").value[:assessments].find { |item| item["record_id"] == highlight.id }
    expect(grade["questions"]).to eq([])
    expect(CareerLibrary::FinishEditService.call(user: user, ai_task_id: task.id)).to be_success
    AiTasks::ApplyAiResultService.call(message: message.merge("result" => message["result"].merge("text" => "Late overwrite")))
    expect(highlight.reload.content).to eq("Updated integration tests to reduce errors.")
    expect(queue).to have_received(:send_message).once
  end

  it "does not reopen discarded batches" do
    answers = [{ questionIndex: 2, answer: "Less repeated work" }]
    task = AiTask.find(answer_batch(answers).dig("aiTask", "id"))
    CareerLibrary::FinishEditService.call(user: user, ai_task_id: task.id, discard: true)
    expect(answer_batch(answers)["errors"]).to include("This answer was discarded. Review this section again for a new question.")
    expect(CareerLibrary::StartEditService.call(user: user, previous_task_id: task.id)).not_to be_success
    expect(highlight.reload.content).to eq("Helped migrate services")
    expect(queue).to have_received(:send_message).once
  end

end
