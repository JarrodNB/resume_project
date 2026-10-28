# Exercises question-only references through queue admission and durable result application.
require "rails_helper"

RSpec.describe "Interview question references" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value }
  let(:prompt) { interview.messages.first }
  let(:queue) { double(send_message: true) }

  before { allow(Shoryuken::Client).to receive(:queues).and_return(queue) }

  it "queues only the exact question and reuses its logical work without changing progress" do
    prompt.update!(acknowledgement: "You repaired a scheduler.")
    original = interview.attributes.slice("revision", "current_question_position")
    result = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)
    expect(result).to be_success
    task = result.value.ai_task
    expect(task.input.keys).to match_array(%w[reference_id question_text])
    expect(task.input["question_text"]).to eq(prompt.content)
    expect(task).to be_interview_references
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id).value.id).to eq(result.value.id)
    expect(queue).to have_received(:send_message).once
    expect(interview.reload.attributes.slice("revision", "current_question_position")).to eq(original)
    expect(interview.messages.answer.count).to eq(0)
  end

  it "freezes complete accepted context for a follow-up and grants its canonical identity" do
    interview.messages.create!(question: prompt.question, kind: "answer", position: 1,
      semantic_key: "reference-answer", content: "I migrated Kubernetes clusters.")
    follow_up = interview.messages.create!(question: prompt.question, kind: "follow_up", position: 2,
      semantic_key: "reference-follow-up", content: "What changed afterward?")
    references = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: follow_up.id).value
    expect(references.ai_task.input["query_text"]).to include(prompt.question.content, follow_up.content, "I migrated Kubernetes clusters.")
    grant = Interviews::CurrentPromptWork::References.new.claim(ai_task: references.ai_task).value
    expect(grant).to include(allowed: true, user_id: interview.user_id, reference_id: references.id,
      query_text: references.ai_task.input["query_text"])
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
  end

  it "rejects a changed queued follow-up query before granting execution" do
    follow_up = interview.messages.create!(question: prompt.question, kind: "follow_up", position: 1,
      semantic_key: "reference-tamper", content: "What changed afterward?")
    references = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: follow_up.id).value
    task = references.ai_task
    task.update!(input: task.input.merge("query_text" => "Arbitrary private search"))
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: task).value).to eq({ allowed: false })
    expect(task.reload).to be_failed
  end

  it "omits oversized context whole and never includes acknowledgements" do
    prompt.question.update!(content: "x" * 12_004)
    follow_up = interview.messages.create!(question: prompt.question, kind: "follow_up", position: 1,
      semantic_key: "reference-bound", content: "What changed afterward?", acknowledgement: "PRIVATE ACK")
    references = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: follow_up.id).value
    expect(references.ai_task.input["query_text"]).to eq(follow_up.content)
  end

  def request_references
    Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id).value
  end

  it "grants one execution, saves one result, and accounts duplicate reports once" do
    references = request_references
    task = references.ai_task
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: task).value).to include(allowed: true, question_text: prompt.content)
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: task).value).to eq({ allowed: false })
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [] },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "input_tokens" => 10, "output_tokens" => 5, "cost_microdollars" => 12 } ] }
    2.times { expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success }
    expect(references.reload.references).to eq(message["result"]["references"])
    expect(task.reload.cost_microdollars).to eq(12)
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id).value.ai_task_id).to eq(task.id)
    expect(interview.messages.answer.count).to eq(0)
  end

  it "leaves existing references unchanged after saving an answer and accepts its copy for a later prompt" do
    existing = request_references
    Interviews::CurrentPromptWork::References.new.claim(ai_task: existing.ai_task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => existing.ai_task_id,
      "status" => "completed", "result" => { "references" => [] } })
    answer = interview.messages.create!(question: prompt.question, kind: "answer", position: 1,
      semantic_key: "copied-answer", content: "Migrated the release pipeline and reduced delays.")
    context = CareerContexts::CreateCareerContextService.call(user: interview.user,
      attributes: { requirement: prompt.content, response: answer.content }).value
    expect(existing.reload.references).to eq([])
    expect(existing.ai_task.reload).to be_completed

    follow_up = interview.messages.create!(question: prompt.question, kind: "follow_up", position: 2,
      semantic_key: "after-career-save", content: "How did the migration reduce delays?")
    later = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: follow_up.id).value
    Interviews::CurrentPromptWork::References.new.claim(ai_task: later.ai_task)
    entry = { "source_type" => "CareerContext", "source_id" => context.id,
      "title" => "Saved career context", "body" => context.response }
    expect(AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => later.ai_task_id,
      "status" => "completed", "result" => { "references" => [ entry ] } })).to be_success
    expect(later.reload.references).to eq([ entry ])
    expect(existing.reload.references).to eq([])
  end

  it "fences a stale result while retaining its usage" do
    references = request_references
    task = references.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    interview.messages.create!(question: prompt.question, kind: "follow_up", position: 1, semantic_key: "test-followup", content: "What did you do next?")
    expect(AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [] },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 13 } ] })).to be_success
    expect(references.reload.references).to eq([])
    expect(task.reload).to be_failed
    expect(task.cost_microdollars).to eq(13)
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
  end

  it "recovers expired claims only through explicit bounded retry and rejects old results" do
    references = request_references
    old_task = references.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: old_task)
    travel 4.minutes do
      same = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id).value
      expect(same.ai_task).to be_failed
      expect(old_task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
      retry_result = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id, retry_failed: true)
      expect(retry_result).to be_success
      expect(retry_result.value.attempt_count).to eq(2)
      task = retry_result.value.ai_task
      expect(task.id).not_to eq(old_task.id)
      expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: old_task).value).to eq({ allowed: false })
      context = create(:career_context, user: interview.user)
      entry = { "source_type" => "CareerContext", "source_id" => context.id, "title" => "Old evidence", "body" => context.response }
      late_result = { "ai_task_id" => old_task.id, "status" => "completed", "result" => { "references" => [ entry ] },
        "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 13 } ] }
      2.times { expect(AiTasks::ApplyAiResultService.call(message: late_result)).to be_success }
      expect(old_task.reload).to have_attributes(status: "failed", cost_microdollars: 13)
      expect(references.reload).to have_attributes(ai_task_id: task.id, references: [])
      expect(task.reload).to be_queued
      task.update!(status: "failed")
      expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id, retry_failed: true)).not_to be_success
    end
  end

  it "fails an expired claimed reference on redelivery before checking its once-only claim" do
    reference = request_references
    task = reference.ai_task
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: task).value[:allowed]).to be(true)
    travel 4.minutes do
      expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: task).value).to eq(allowed: false)
      expect(task.reload).to be_failed
      expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
      expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id).value.ai_task_id).to eq(task.id)
    end
  end

  %w[abandoned expired completed].each do |state|
    it "denies #{state} sessions at request, claim and result boundaries" do
      references = request_references
      task = references.ai_task
      interview.update!(status: state)
      expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
      expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: task).value).to eq({ allowed: false })
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [] } })
      expect(references.reload.references).to eq([])
      expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
    end
  end

  it "shares the persisted preparation admission and keeps general AI limits separate" do
    interview.operations.create!(kind: "preparation").tap do |operation|
      operation.update!(ai_task: interview.user.ai_tasks.create!(task_type: "interview_preparation", status: "completed", subject: interview, input: { operation_id: operation.id }))
    end
    interview.user.update!(monthly_ai_budget_microdollars: 0)
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 1)
    references = request_references
    root = interview.operations.preparation.first.ai_task
    expect(references.ai_task.hourly_admission_task_id).to eq(root.id)
    expect(interview.user.ai_tasks.spoken_interview.hourly_admissions.count).to eq(1)
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: references.ai_task).value[:allowed]).to be(true)
    expect(interview.user.ai_tasks.general_ai).to be_empty
  end

  it "enforces the interview hourly, spend and in-flight allowances" do
    interview
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 0)
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    stub_const("DEFAULT_INTERVIEW_SESSIONS_PER_HOUR", 10)
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 0)
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 1_000_000)
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 0)
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    expect(interview.career_references.reload).to be_empty
  end

  it "rejects another owner's prompt and invalid preparation links" do
    other = Interviews::CreateFixtureService.call(user: create(:user)).value
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: other.messages.first.id)).not_to be_success
    interview.operations.create!(kind: "preparation")
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
  end

  it "expires work and scrubs every references attempt without deleting billing" do
    references = request_references
    task = references.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [] },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 19 } ] })
    interview.update!(expires_at: 1.second.ago)
    Interviews::CleanupService.call(storage: instance_double(Interviews::MediaStorage, delete: nil))
    expect(references.reload.references).to eq([])
    expect(task.reload).to have_attributes(input: {}, result: nil, cost_microdollars: 19)
  end

  it "records a queue publication failure without leaking the transport error" do
    allow(queue).to receive(:send_message).and_raise(Seahorse::Client::NetworkingError.new(IOError.new("private transport error")))
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    task = interview.career_references.sole.ai_task
    expect(task.ai_task_outcomes.pluck(:status)).to eq([ "failed" ])
    expect(AiTasks::DescribeTaskOutcomeService.call(outcome: task.ai_task_outcomes.sole).value[:title]).to eq("Career references failed")
  end

  it "does not overwrite an accepted result if queue publication reports an ambiguous failure" do
    allow(queue).to receive(:send_message) do
      references = interview.career_references.first
      task = references.ai_task
      Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
      AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [] } })
      raise Seahorse::Client::NetworkingError.new(IOError.new("lost acknowledgement"))
    end
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)).not_to be_success
    expect(interview.career_references.first.ai_task).to be_completed
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id).value.references).to eq([])
  end
  it "never queues paid references for saved fake sessions" do
    fake = Interviews::CreateFixtureService.call(user: interview.user).value
    expect(Interviews::CurrentPromptWork::References.new.request(interview: fake, message_id: fake.messages.first.id)).not_to be_success
    expect(fake.career_references.reload).to be_empty
    expect(queue).not_to have_received(:send_message)
  end
  it "persists exact owned context responses and rejects another owner's source" do
    reference = request_references
    task = reference.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    context = create(:career_context, user: interview.user)
    entry = { "source_type" => "CareerContext", "source_id" => context.id, "title" => "Saved career context", "body" => context.response }
    message = { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [ entry ] } }
    expect(AiTasks::ApplyAiResultService.call(message: message)).to be_success
    expect(reference.reload.references).to eq([ entry ])
    expect(task.reload).to be_completed
    expect(Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id).value.id).to eq(reference.id)
  end

  it "rejects foreign or invented evidence without changing dialogue" do
    reference = request_references
    task = reference.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    context = create(:career_context)
    entry = { "source_type" => "CareerContext", "source_id" => context.id, "title" => "Saved career context", "body" => context.response }
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [ entry ] } })
    expect(reference.reload.references).to eq([])
    expect(task.reload).to be_failed
    expect(interview.messages.answer.count).to eq(0)
  end

  it "rejects altered wording from an owned source while retaining its usage" do
    reference = request_references
    task = reference.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    context = create(:career_context, user: interview.user, response: "Coordinated a service migration.")
    entry = { "source_type" => "CareerContext", "source_id" => context.id, "title" => "Saved context", "body" => "Led every service migration." }
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [ entry ] },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 9 } ] })
    expect(task.reload).to have_attributes(status: "failed", error_message: "Invalid career references", cost_microdollars: 9)
    expect(reference.reload.references).to eq([])
  end

  it "requests and claims references by default without an enablement setting" do
    result = Interviews::CurrentPromptWork::References.new.request(interview: interview, message_id: prompt.id)
    expect(result).to be_success
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: result.value.ai_task).value[:allowed]).to be(true)
    expect(interview.reload).to be_active
  end

  it "accepts an exact saved education degree when no narrative description exists" do
    reference = request_references
    task = reference.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    education = create(:education, user: interview.user, description: nil, degree: "Bachelor of Science")
    entry = { "source_type" => "Education", "source_id" => education.id, "title" => education.institution, "body" => education.degree }
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [ entry ] } })
    expect(task.reload).to be_completed
    expect(reference.reload.references).to eq([ entry ])
  end

  it "keeps answer claims independent of saved career references" do
    reference = request_references
    task = reference.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    context = create(:career_context, user: interview.user, response: "Unique reference-only career detail")
    entry = { "source_type" => "CareerContext", "source_id" => context.id, "title" => "Saved context", "body" => context.response }
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [ entry ] },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 29 } ] })
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: prompt.question_id, expected_revision: interview.revision,
      submission_key: "references-independent-answer", transcription_mode: "typed", candidate_transcript: "My reviewed answer")
    expect(turn).to be_success
    claim = Interviews::ClaimOperationService.call(operation: turn.value, execution_mode: "real")
    expect(claim).to be_success
    expect(JSON.generate(claim.value)).not_to include(context.response, reference.id)
    expect(task.reload.cost_microdollars).to eq(29)
    expect(reference.reload.references).to eq([ entry ])
  end

  it "allows skipping during retrieval and fences its late result while retaining usage" do
    reference = request_references
    task = reference.ai_task
    Interviews::CurrentPromptWork::References.new.claim(ai_task: task)
    expect(Interviews::SkipQuestionService.call(interview: interview, question_id: prompt.question_id,
      expected_revision: interview.revision, submission_key: "skip-with-references")).to be_success
    AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [] },
      "attempt_id" => SecureRandom.uuid, "usage" => [ { "model" => "test", "cost_microdollars" => 7 } ] })
    expect(task.reload).to be_failed
    expect(task.cost_microdollars).to eq(7)
    expect(reference.reload.references).to eq([])
    expect(interview.messages.answer.count).to eq(0)
  end

  it "keeps a full reference queue from blocking accepted-answer execution" do
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 3)
    current = Interviews::CreateFixtureService.call(user: interview.user, question_count: 2, execution_mode: "real").value
    current.questions.create!(content: "Tell me about collaborating with a colleague.", position: 2)
    preparation = current.operations.create!(kind: "preparation")
    root = current.user.ai_tasks.create!(task_type: "interview_preparation", subject: current, status: "completed", input: { operation_id: preparation.id })
    preparation.update!(ai_task: root)
    3.times do |index|
      message = current.messages.order(:position).last
      expect(Interviews::CurrentPromptWork::References.new.request(interview: current, message_id: message.id)).to be_success
      if index < 2
        expect(Interviews::SkipQuestionService.call(interview: current, question_id: message.question_id,
          expected_revision: current.revision, submission_key: "reference-cap-skip-#{index}")).to be_success
      end
    end
    message = current.messages.order(:position).last
    submitted = Interviews::SubmitTurnService.call(interview: current, question_id: message.question_id,
      expected_revision: current.revision, submission_key: "reference-cap-answer", transcription_mode: "typed", candidate_transcript: "My answer.")
    expect(submitted).to be_success
    expect(current.user.ai_tasks.interview_references.queued.count).to eq(3)
    expect(Interviews::ClaimOperationService.call(operation: submitted.value, execution_mode: "real")).to be_success
  end

  it "bounds reference requests separately and permits a reference to claim its own slot" do
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 1)
    create(:ai_task, user: interview.user, task_type: "interview_turn")
    reference = request_references
    expect(reference).to be_persisted
    other = Interviews::CreateFixtureService.call(user: interview.user, execution_mode: "real").value
    denied = Interviews::CurrentPromptWork::References.new.request(interview: other, message_id: other.messages.first.id)
    expect(denied.errors.join).to include("career references running")
    expect(other.career_references.reload).to be_empty
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: reference.ai_task).value[:allowed]).to be(true)
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, interview: true).errors.join).to include("interview operations running")
  end

  it "still charges reference spend to the shared interview budget" do
    reference = request_references
    stub_const("DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS", 20)
    create(:ai_task, user: interview.user, task_type: "interview_references", status: "completed", cost_microdollars: 20)
    expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: reference.ai_task).value).to eq(allowed: false)
    expect(reference.ai_task.reload).to be_failed
    expect(reference.ai_task.error_message).to include("month's interview usage limit")
    expect(AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, interview: true).errors.join).to include("month's interview usage limit")
  end

  [ false, true ].each do |redelivered|
    it "releases expired earlier-prompt capacity #{redelivered ? 'with' : 'without'} queue redelivery" do
      stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 3)
      current = Interviews::CreateFixtureService.call(user: interview.user, execution_mode: "real", question_count: 2).value
      [ 2, 3 ].each { |position| current.questions.create!(content: "Describe a project.", position: position) }
      references = 3.times.map do |index|
        message = current.messages.order(:position).last
        requested = Interviews::CurrentPromptWork::References.new.request(interview: current, message_id: message.id)
        expect(requested).to be_success
        reference = requested.value
        expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: reference.ai_task).value[:allowed]).to be(true)
        expect(Interviews::SkipQuestionService.call(interview: current, question_id: message.question_id,
          expected_revision: current.revision, submission_key: "reference-timeout-skip-#{index}")).to be_success
        reference
      end
      travel 4.minutes do
        if redelivered
          references.each do |reference|
            expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: reference.ai_task).value).to eq(allowed: false)
            expect(reference.ai_task.reload).to be_failed
          end
        end
        message = current.messages.order(:position).last
        next_request = Interviews::CurrentPromptWork::References.new.request(interview: current, message_id: message.id)
        expect(next_request).to be_success
        expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: next_request.value.ai_task).value[:allowed]).to be(true)
        task = references.first.ai_task
        2.times do
          AiTasks::ApplyAiResultService.call(message: { "ai_task_id" => task.id, "status" => "completed", "result" => { "references" => [] },
            "attempt_id" => "5e0dfcec-0000-4000-8000-000000000001", "usage" => [ { "model" => "test", "cost_microdollars" => 17 } ] })
        end
        expect(task.reload).to be_failed
        expect(task.cost_microdollars).to eq(17)
        expect(references.first.reload.references).to eq([])
        expect(Interviews::CurrentPromptWork::References.new.claim(ai_task: task).value).to eq(allowed: false)
      end
    end
  end
end
