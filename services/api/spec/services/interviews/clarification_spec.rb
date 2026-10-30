# Exercises question-only clarification through queue admission and durable result application.
require "rails_helper"

RSpec.describe "Interview question clarification" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value }
  let(:prompt) { interview.messages.first }
  let(:queue) { double(send_message: true) }

  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  it "queues only question identities and a digest and reuses its logical work without changing progress" do
    prompt.update!(acknowledgement: "You repaired a scheduler.")
    original = interview.attributes.slice("revision", "current_question_position")
    result = Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)
    expect(result).to be_success
    task = result.value.ai_task
    expect(task.input.keys).to match_array(%w[clarification_id message_id question_digest])
    expect(task.input["question_digest"]).to eq(Digest::SHA256.hexdigest(prompt.content))
    expect(task).to be_interview_clarification
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id).value.id).to eq(result.value.id)
    expect(queue).to have_received(:send_message).once do |message_body:|
      expect(JSON.parse(message_body)).to eq("schema_version" => 1, "ai_task_id" => task.id,
        "user_id" => interview.user_id, "task_type" => task.task_type)
    end
    expect(interview.reload.attributes.slice("revision", "current_question_position")).to eq(original)
    expect(interview.messages.answer.count).to eq(0)
  end

  def request_clarification
    Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id).value
  end

  it "grants one execution, saves one result, and accounts duplicate reports once" do
    clarification = request_clarification
    task = clarification.ai_task
    grant = Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task).value
    expect(grant.keys).to match_array(%i[allowed interview_id record_id claimed_at])
    expect(grant).to include(allowed: true, interview_id: interview.id)
    expect(Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task).value).to eq({ allowed: false })
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "explanation" => "Describe a real situation where you worked with others to solve a problem." },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "input_tokens" => 10, "output_tokens" => 5, "cost_microdollars" => 12 } ] }
    2.times { expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success }
    expect(clarification.reload.explanation).to eq(message["result"]["explanation"])
    expect(task.reload.cost_microdollars).to eq(12)
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id).value.ai_task_id).to eq(task.id)
    expect(interview.messages.answer.count).to eq(0)
  end

  it "fences a stale result while retaining its usage" do
    clarification = request_clarification
    task = clarification.ai_task
    Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task)
    interview.messages.create!(question: prompt.question, kind: "follow_up", position: 1, semantic_key: "test-followup", content: "What did you do next?")
    expect(AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "explanation" => "Old explanation" },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 13 } ] })).to be_success
    expect(clarification.reload.explanation).to be_nil
    expect(task.reload).to be_failed
    expect(task.cost_microdollars).to eq(13)
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
  end

  it "rejects a blank explanation and retains new late usage once without changing the failed outcome" do
    clarification = request_clarification
    task = clarification.ai_task
    Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "explanation" => "  " } })
    expect(task.reload).to be_failed
    expect(task.error_message).to eq("Invalid question clarification")
    expect(clarification.reload.explanation).to be_nil
    late_usage = { "ai_task_id" => task.id, "status" => "usage", "attempt_id" => SecureRandom.uuid,
      "usage" => [ { "model" => "test", "cost_microdollars" => 11 } ] }
    2.times { expect(AiTasks::ApplyAiResultService.call(message: late_usage)).to be_success }
    expect(task.reload).to have_attributes(status: "failed", cost_microdollars: 11)
    expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
  end

  it "recovers expired claims only through explicit bounded retry and rejects old results" do
    clarification = request_clarification
    old_task = clarification.ai_task
    Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: old_task)
    travel 4.minutes do
      same = Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id).value
      expect(same.ai_task).to be_failed
      expect(old_task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
      retry_result = Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id, retry_failed: true)
      expect(retry_result).to be_success
      expect(retry_result.value.attempt_count).to eq(2)
      task = retry_result.value.ai_task
      expect(task.id).not_to eq(old_task.id)
      expect(Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: old_task).value).to eq({ allowed: false })
      late_result = { "ai_task_id" => old_task.id, "status" => "completed", "result" => { "explanation" => "Old explanation" },
        "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 13 } ] }
      2.times { expect(AiTasks::ApplyAiResultService.call(message: late_result)).to be_success }
      expect(old_task.reload).to have_attributes(status: "failed", cost_microdollars: 13)
      expect(clarification.reload).to have_attributes(ai_task_id: task.id, explanation: nil)
      expect(task.reload).to be_queued
      task.update!(status: "failed")
      expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id, retry_failed: true)).not_to be_success
    end
  end

  it "leaves an already claimed clarification queued on expired redelivery until explicit request recovery" do
    clarification = request_clarification
    task = clarification.ai_task
    expect(Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task).value[:allowed]).to be(true)
    travel 4.minutes do
      expect(Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task).value).to eq(allowed: false)
      expect(task.reload).to be_queued
      expect(task.ai_task_outcomes).to be_empty
      expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id).value.ai_task).to be_failed
    end
  end

  %w[abandoned expired completed].each do |state|
    it "denies #{state} sessions at request, claim and result boundaries" do
      clarification = request_clarification
      task = clarification.ai_task
      interview.update!(status: state)
      expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
      expect(Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task).value).to eq({ allowed: false })
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "explanation" => "Unavailable" } })
      expect(clarification.reload.explanation).to be_nil
      expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
    end
  end

  it "shares the persisted preparation admission and keeps general AI limits separate" do
    interview.operations.create!(kind: "preparation").tap do |operation|
      operation.update!(ai_task: interview.user.ai_tasks.create!(task_type: "interview_preparation", status: "completed", subject: interview, input: { operation_id: operation.id }))
    end
    interview.user.update!(monthly_ai_budget_microdollars: 0)
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    clarification = request_clarification
    root = interview.operations.preparation.first.ai_task
    expect(clarification.ai_task.hourly_admission_task_id).to eq(root.id)
    expect(interview.user.ai_tasks.spoken_interview.hourly_admissions.count).to eq(1)
    expect(Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: clarification.ai_task).value[:allowed]).to be(true)
    expect(interview.user.ai_tasks.general_ai).to be_empty
  end

  it "enforces the interview hourly, spend and in-flight allowances" do
    interview
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 0)
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 10)
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 0)
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 1_000_000)
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 0)
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    expect(interview.clarifications.reload).to be_empty
  end

  it "rejects another owner's prompt and invalid preparation links" do
    other = Interviews::CreateFixtureService.call(user: create(:user)).value
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: other.messages.first.id)).not_to be_success
    interview.operations.create!(kind: "preparation")
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
  end

  it "expires work and scrubs every clarification attempt without deleting billing" do
    clarification = request_clarification
    task = clarification.ai_task
    Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "explanation" => "Private explanation" },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 19 } ] })
    interview.update!(expires_at: 1.second.ago)
    Interviews::CleanupService.call(storage: instance_double(Interviews::MediaStorage, delete: nil))
    expect(clarification.reload.explanation).to be_nil
    expect(task.reload).to have_attributes(input: {}, result: nil, cost_microdollars: 19)
  end

  it "records a queue publication failure without leaking the transport error" do
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(IOError.new("private transport error")))
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    task = interview.clarifications.sole.ai_task
    expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
    expect(AiTasks::DescribeTaskOutcomeService.call(outcome: task.ai_task_outcomes.sole).value[:title]).to eq("Question clarification failed")
  end

  it "does not overwrite an accepted result if queue publication reports an ambiguous failure" do
    allow(queue).to receive(:send_message) do
      clarification = interview.clarifications.first
      task = clarification.ai_task
      Interviews::CurrentPromptWork::Clarification.new.claim(ai_task: task)
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "explanation" => "Explain what the question asks." } })
      raise Seahorse::Client::NetworkingError.new(IOError.new("lost acknowledgement"))
    end
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    expect(interview.clarifications.first.ai_task).to be_completed
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: interview, message_id: prompt.id).value.explanation).to eq("Explain what the question asks.")
  end
  it "never queues paid clarification for saved fake sessions" do
    fake = Interviews::CreateFixtureService.call(user: interview.user).value
    expect(Interviews::CurrentPromptWork::Clarification.new.request(interview: fake, message_id: fake.messages.first.id)).not_to be_success
    expect(fake.clarifications.reload).to be_empty
    expect(queue).not_to have_received(:send_message)
  end
end
