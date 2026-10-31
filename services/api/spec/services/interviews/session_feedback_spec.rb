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
    expect(queue).to have_received(:send_message).once do |message_body:|
      expect(JSON.parse(message_body)).to eq("schema_version" => 1, "ai_task_id" => record.ai_task_id,
        "user_id" => interview.user_id, "task_type" => "interview_session_feedback")
    end
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
    expect(grant.keys).to match_array(%i[allowed interview_id record_id claimed_at])
    expect(grant).to include(interview_id: interview.id, record_id: record.id)
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
      transcript: "I built a scheduler.", decision: "advance")
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

  it "purges coaching and every attempt payload with expired dialogue while preserving usage" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    task = record.ai_task
    service.claim(ai_task: task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_session_feedback" => content },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 19 } ] })
    interview.update!(expires_at: 1.minute.ago)
    expect(Interviews::CleanupService.call(storage: double(delete: true))).to be_success
    expect(record.reload.content).to eq({})
    expect(task.reload).to have_attributes(input: {}, result: nil, status: "completed", cost_microdollars: 19)
    expect(interview.reload.content_purged_at).to be_present
  end


  it "removes deleted-session feedback payloads but retains the accounting task" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    task = record.ai_task
    service.claim(ai_task: task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_session_feedback" => content },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 19 } ] })
    interview.destroy!
    expect(InterviewSessionFeedback.exists?(record.id)).to be(false)
    expect(task.reload).to have_attributes(input: {}, result: nil, status: "completed", cost_microdollars: 19)
    expect(service.claim(ai_task: task).value).to eq(allowed: false)
  end


  it "recovers queue failure only through an explicit bounded retry without losing dialogue" do
    service = Interviews::SessionFeedback.new
    allow(queue).to receive(:send_message).and_raise(Aws::SQS::Errors::ServiceError.new(nil, "offline"))
    expect(service.request(interview: interview)).not_to be_success
    record = interview.reload.feedback
    failed = record.ai_task
    expect(failed).to be_failed
    expect(failed.error_message).to include("Could not queue feedback")
    expect(interview.messages.answer.pluck(:content)).to eq([ "I built a scheduler and tested it with the team." ])
    allow(queue).to receive(:send_message).and_return(true)
    expect(service.request(interview: interview).value.ai_task_id).to eq(failed.id)
    expect(service.request(interview: interview, retry_failed: true)).to be_success
    expect(record.reload.attempt_count).to eq(2)
    expect(record.ai_task_id).not_to eq(failed.id)
    expect(service.claim(ai_task: failed).value).to eq(allowed: false)
    expect(service.claim(ai_task: record.ai_task).value[:allowed]).to be(true)
  end

  it "times out a claimed attempt and fences its late result after an explicit retry" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    old = record.ai_task
    expect(service.claim(ai_task: old).value[:allowed]).to be(true)
    travel 6.minutes do
      expect(service.request(interview: interview).value.ai_task).to be_failed
      expect(old.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
      expect(service.request(interview: interview, retry_failed: true)).to be_success
      current = record.reload.ai_task
      expect(current.id).not_to eq(old.id)
      expect(service.claim(ai_task: old).value).to eq(allowed: false)
      late = { "ai_task_id" => old.id, "status" => "completed", "result" => { "interview_session_feedback" => content },
        "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 13 } ] }
      2.times { expect(AiTasks::ApplyAiResultService.call(message: late)).to be_success }
      expect(old.reload).to have_attributes(status: "failed", cost_microdollars: 13)
      expect(record.reload).to have_attributes(ai_task_id: current.id, content: {})
      expect(service.claim(ai_task: current).value[:allowed]).to be(true)
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => current.id, "status" => "failed", "error_message" => "Provider unavailable" })
      expect(service.request(interview: interview, retry_failed: true).errors).to include("Feedback retry limit reached")
      expect(record.reload.attempt_count).to eq(2)
    end
  end

  it "makes provider failure retryable while preserving accepted answers and existing usage" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    old = record.ai_task
    service.claim(ai_task: old)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => old.id, "status" => "failed", "error_message" => "Feedback generation failed. Please retry.",
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 8 } ] })
    expect(service.request(interview: interview).value.ai_task_id).to eq(old.id)
    expect(service.request(interview: interview, retry_failed: true)).to be_success
    expect(old.reload).to have_attributes(status: "failed", cost_microdollars: 8)
    expect(interview.messages.answer.count).to eq(1)
    expect(record.reload.content).to eq({})
  end

  it "rejects expired request, retry, claim and result acceptance while keeping late usage" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    task = record.ai_task
    service.claim(ai_task: task)
    interview.update!(expires_at: 1.second.ago)
    expect(service.request(interview: interview)).not_to be_success
    expect(service.request(interview: interview, retry_failed: true)).not_to be_success
    expect(service.claim(ai_task: task).value).to eq(allowed: false)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_session_feedback" => content },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 14 } ] })
    expect(task.reload).to have_attributes(status: "failed", cost_microdollars: 14)
    expect(record.reload.content).to eq({})
  end

  it "fails deleted pending work and accounts late results without recreating content" do
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    task = record.ai_task
    output = content
    interview.destroy!
    expect(task.reload).to have_attributes(status: "failed", input: {}, result: nil)
    expect(service.claim(ai_task: task).value).to eq(allowed: false)
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "interview_session_feedback" => output },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 11 } ] }
    2.times { AiTasks::ApplyAiResultService.call(message: message) }
    expect(task.reload).to have_attributes(status: "failed", result: nil, cost_microdollars: 11)
    expect(InterviewSessionFeedback.exists?(record.id)).to be(false)
  end

  it "reuses preparation admission and enforces interview spend independently from general AI" do
    operation = interview.operations.create!(kind: "preparation")
    root = interview.user.ai_tasks.create!(task_type: "interview_preparation", status: "completed", subject: interview, input: { operation_id: operation.id })
    operation.update!(ai_task: root)
    interview.user.update!(monthly_ai_budget_microdollars: 0)
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    service = Interviews::SessionFeedback.new
    record = service.request(interview: interview).value
    expect(record.ai_task.hourly_admission_task_id).to eq(root.id)
    expect(interview.user.ai_tasks.spoken_interview.hourly_admissions.count).to eq(1)
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 20)
    create(:ai_task, user: interview.user, task_type: "interview_session_feedback", status: "completed", cost_microdollars: 20)
    allow(ApiSchema.subscriptions).to receive(:trigger)
    expect(service.claim(ai_task: record.ai_task).value).to eq(allowed: false)
    expect(record.ai_task.reload).to be_failed
    expect(record.ai_task.error_message).to include("month's interview usage limit")
    expect(ApiSchema.subscriptions).to have_received(:trigger).with(:ai_task_updated, { id: record.ai_task_id }, record.ai_task)
    expect(service.request(interview: interview, retry_failed: true)).not_to be_success
    expect(record.reload.attempt_count).to eq(1)
  end
end
