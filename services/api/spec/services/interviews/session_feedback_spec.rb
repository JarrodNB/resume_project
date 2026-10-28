# Exercises on-demand coaching through owned admission, execution claims and result acceptance.
require "rails_helper"

RSpec.describe "Completed interview feedback" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value }
  let(:question) { interview.questions.first }
  let(:queue) { double(send_message: true) }
  before do
    allow(Shoryuken::Client).to receive(:queues).and_return(queue)
    interview.messages.create!(question: question, kind: "answer", position: 1, semantic_key: "saved-answer", content: "I built a scheduler and tested it with the team.")
    interview.update!(status: "completed", completed_at: Time.current)
  end

  it "queues feedback only on request and reuses the saved logical work" do
    expect(interview.user.ai_tasks.where(task_type: "interview_session_feedback")).to be_empty
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    expect(record).to be_persisted
    expect(record.ai_task.task_type).to eq("interview_session_feedback")
    expect(record.ai_task.input).to eq("feedback_id" => record.id)
    expect(service.request(interview: interview).value.id).to eq(record.id)
    expect(queue).to have_received(:send_message).once
  end

  def content
    { "summary" => "You explained your own contribution. Practice making the outcome clearer.", "questions" => [
      { "question_id" => question.id, "strengths" => [ "A specific contribution." ], "improvements" => [ "Explain what changed." ], "example_answer" => "I built a scheduler and tested it with the team. [Add the result you observed.]" }
    ] }
  end

  it "claims accepted dialogue once, excludes unanswered questions and saves one result with deduplicated usage" do
    interview.questions.create!(content: "What is a queue?", position: 1, skipped_at: Time.current)
    interview.messages.create!(question: question, kind: "follow_up", position: 2, semantic_key: "followup", content: "How did you test it?")
    interview.messages.create!(question: question, kind: "answer", position: 3, semantic_key: "followup-answer", content: "I added integration tests.")
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    task = record.ai_task
    grant = service.claim(ai_task: task).value
    expect(grant[:allowed]).to be(true)
    expect(grant[:questions].pluck(:question_id)).to eq([ question.id ])
    expect(grant[:questions].first[:dialogue].pluck(:content)).to eq([ "I built a scheduler and tested it with the team.", "How did you test it?", "I added integration tests." ])
    expect(service.claim(ai_task: task).value).to eq(allowed: false)
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_session_feedback" => content },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 12 } ] }
    2.times { expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success }
    expect(record.reload.content).to eq(content)
    expect(task.reload).to have_attributes(status: "completed", cost_microdollars: 12)
    expect(service.request(interview: interview, retry_failed: true).value.ai_task_id).to eq(task.id)
  end

  it "refuses active, expired and unanswered interviews without paid work" do
    service = Interviews::SessionFeedback.new
    interview.update!(status: "active")
    expect(service.request(interview: interview)).not_to be_success
    interview.update!(status: "completed", expires_at: 1.minute.ago)
    expect(service.request(interview: interview)).not_to be_success
    interview.update!(expires_at: 1.day.from_now)
    interview.messages.answer.destroy_all
    expect(service.request(interview: interview).errors.join).to include("No answers")
    expect(queue).not_to have_received(:send_message)
  end

  it "rejects an unclaimed or incorrectly associated result" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    task = record.ai_task
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_session_feedback" => content } })
    expect(task.reload).to be_failed
    expect(record.reload.content).to eq({})
  end

  it "validates the exact answered question identities and nonblank coaching" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    service.claim(ai_task: record.ai_task)
    invalid = content.deep_dup
    invalid["questions"].first["question_id"] = SecureRandom.uuid
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => record.ai_task_id, "status" => "completed", "result" => { "interview_session_feedback" => invalid } })
    expect(record.reload.ai_task).to be_failed
    expect(record.content).to eq({})
  end


  it "does not generate feedback when accepting the final answer or skipping the final question" do
    service = Interviews::SessionFeedback.new
    interview.messages.answer.destroy_all
    interview.update!(status: "active", completed_at: nil)
    attempt = SecureRandom.uuid
    operation = interview.operations.create!(kind: "turn", question: question, status: "running", transcription_mode: "typed",
      candidate_transcript: "I built a scheduler.", submission_key: "finish", request_fingerprint: "test", expected_revision: interview.revision,
      claim_generation: 1, attempt_id: attempt, lease_expires_at: 1.minute.from_now, execution_deadline: 2.minutes.from_now)
    result = Interviews::AcceptTurnService.call(operation: operation, attempt_id: attempt, claim_generation: 1,
      transcript: "I built a scheduler.", decision: "advance", history_version: 1, model_history: [])
    expect(result).to be_success
    expect(interview.reload).to be_completed
    expect(interview.feedback).to be_nil
    expect(interview.user.ai_tasks.where(task_type: "interview_session_feedback")).to be_empty
    expect(service.request(interview: interview)).to be_success

    second = Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value
    skipped = Interviews::SkipQuestionService.call(interview: second, question_id: second.questions.first.id,
      expected_revision: second.revision, submission_key: "skip-final")
    expect(skipped).to be_success
    expect(second.reload).to be_completed
    expect(second.feedback).to be_nil
    expect(second.user.ai_tasks.where(task_type: "interview_session_feedback")).to be_empty
    expect(service.request(interview: second)).not_to be_success
  end
end
