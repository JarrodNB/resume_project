# Observes committed dialogue, history, counts, and speech work at the acceptance boundary.
require "rails_helper"

RSpec.describe "Basic Interview acceptance" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:question) { interview.questions.first }
  let(:operation) do
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: interview.revision, submission_key: SecureRandom.uuid).value
    turn.update!(status: "running", claim_generation: 1, attempt_id: SecureRandom.uuid,
      lease_expires_at: 30.seconds.from_now, execution_deadline: 2.minutes.from_now)
    turn
  end
  let(:input) do
    { operation: operation, attempt_id: operation.attempt_id, claim_generation: operation.claim_generation,
      transcript: "I paired with a teammate to fix our scheduler.", decision: "continue",
      reply: "What changed after that?", history_version: 1,
      model_history: [ { "kind" => "request", "parts" => [ { "part_kind" => "user-prompt", "content" => "screened transcript" } ] } ] }
  end

  it "saves acknowledgement separately and speaks it before the accepted follow-up" do
    acknowledgement = "You paired with a teammate to repair the scheduler."
    expect(Interviews::AcceptTurnService.call(**input, acknowledgement: acknowledgement)).to be_success
    response = interview.messages.follow_up.last
    expect(response).to have_attributes(content: input[:reply], acknowledgement: acknowledgement)
    speech = interview.operations.speech.find_by!(message: response)
    claim = Interviews::ClaimOperationService.call(operation: speech)
    expect(claim).to be_success
    expect(claim.value.fetch(:payload)).to include(interview_id: interview.id)
    expect(Interviews::MessageText.spoken_content(speech.message)).to eq("#{acknowledgement}\n\n#{input[:reply]}")
  end

  [ [ "advance", false, true ], [ "continue", true, true ],
    [ "advance", false, false ], [ "continue", true, false ] ].each do |decision, at_cap, has_next|
    it "acknowledges #{decision} at_cap=#{at_cap} has_next=#{has_next} before the Rails-owned transition" do
      next_question = interview.questions.create!(position: 1, content: "How did you prioritize the work?", question_type: "behavioral") if has_next
      question.update!(accepted_answer_count: interview.answer_cap - 1) if at_cap
      payload = input.merge(decision: decision, reply: decision == "advance" ? nil : input[:reply],
        acknowledgement: "You repaired the scheduler with a teammate.")
      first = Interviews::AcceptTurnService.call(**payload)
      expect(first).to be_success
      response = interview.messages.order(:position).last
      expect(response).to have_attributes(kind: has_next ? "opening" : "closing",
        content: has_next ? next_question.content : Interviews::AcceptTurnService::CLOSING,
        acknowledgement: payload[:acknowledgement])
      expect(interview.reload.current_question_position).to eq(has_next ? 1 : 0)
      expect(interview.operations.speech.where(message: response).exists?).to eq(has_next)
      count = interview.messages.count
      expect(Interviews::AcceptTurnService.call(**payload).value).to eq(first.value)
      expect(interview.messages.count).to eq(count)
      expect(Interviews::AcceptTurnService.call(**payload.merge(acknowledgement: "A different acknowledgement."))).not_to be_success
    end
  end

  [ "", " ", "x" * 281, 123 ].each do |acknowledgement|
    it "rejects invalid acknowledgement #{acknowledgement.inspect[0, 20]} without committing an answer" do
      expect(Interviews::AcceptTurnService.call(**input, acknowledgement: acknowledgement)).not_to be_success
      expect(interview.reload.revision).to eq(0)
      expect(interview.messages.answer).to be_empty
    end
  end

  it "rejects a combined acknowledgement and follow-up that exceeds the speech limit" do
    expect(Interviews::AcceptTurnService.call(**input.merge(reply: "x" * TextLimits::PROSE),
      acknowledgement: "You repaired the scheduler.")).not_to be_success
    expect(interview.reload.revision).to eq(0)
  end

  it "acknowledges a finished execution heartbeat without renewing its lease or accepting stale identities" do
    freeze_time
    expect(Interviews::AcceptTurnService.call(**input)).to be_success
    identity = input.slice(:operation, :attempt_id, :claim_generation)
    saved = operation.reload.attributes

    2.times do
      result = Interviews::RenewClaimService.call(**identity)
      expect(result).to be_success
      expect(result.value).to eq({ execution_finished: true })
    end
    expect(operation.reload.attributes).to eq(saved)
    expect(Interviews::RenewClaimService.call(**identity.merge(attempt_id: SecureRandom.uuid))).not_to be_success
    expect(Interviews::RenewClaimService.call(**identity.merge(claim_generation: 0))).not_to be_success
    expect(Interviews::RenewClaimService.call(**identity, checkpoint: "transcribed")).not_to be_success
    expect(Interviews::StartProviderAttemptService.call(**identity, observation_id: SecureRandom.uuid,
      stage: "interviewer", provider: "fake", model: "scripted-v1")).not_to be_success
    travel_to(operation.execution_deadline + 1.second) do
      expect(Interviews::RenewClaimService.call(**identity)).to be_success
      expect(operation.reload.attributes).to eq(saved)
    end
    travel_to(interview.expires_at) { expect(Interviews::RenewClaimService.call(**identity)).not_to be_success }
    interview.update!(status: "abandoned")
    expect(Interviews::RenewClaimService.call(**identity)).not_to be_success
  end

  it "saves real interview replies without scheduling provider speech by default" do
    InterviewSession.where(id: interview.id).update_all(execution_mode: "real", execution_config: Interviews::ExecutionConfiguration::REAL)
    interview.reload
    expect { expect(Interviews::AcceptTurnService.call(**input)).to be_success }
      .not_to change { interview.operations.speech.count }
  end

  it "accepts an answer, saved follow-up and history together, incrementing only once" do
    result = Interviews::AcceptTurnService.call(**input)
    expect(result).to be_success
    expect(interview.messages.pluck(:kind)).to eq(%w[opening answer follow_up])
    expect(question.reload).to have_attributes(accepted_answer_count: 1, history_version: 1, model_history: input[:model_history])
    expect(interview.reload).to have_attributes(revision: 1, status: "active")
    expect(interview.operations.speech.count).to eq(2)
    expect(operation.reload).to have_attributes(status: "accepted", accepted_result: result.value)
    repeated = Interviews::AcceptTurnService.call(**input)
    expect(repeated).to be_success
    expect(repeated.value).to eq(result.value)
    expect(interview.messages.count).to eq(3)
    expect(question.reload.accepted_answer_count).to eq(1)
  end
  it "honors early advancement with a fixed final closing and no generated transition" do
    result = Interviews::AcceptTurnService.call(**input.merge(decision: "advance", reply: nil))
    expect(result).to be_success
    expect(interview.reload).to have_attributes(status: "completed", revision: 1)
    expect(interview.completed_at).to be_present
    expect(question.reload.accepted_answer_count).to eq(1)
    expect(interview.messages.pluck(:kind)).to eq(%w[opening answer closing])
    expect(interview.messages.last.content).to eq("Thank you. This interview is complete.")
  end

  it "forces completion at the cap even when the executor asks to continue" do
    expect(Interviews::AcceptTurnService.call(**input)).to be_success
    next_turn = Interviews::SubmitTurnService.call(interview: interview.reload, question_id: question.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: 1, submission_key: "second").value
    next_turn.update!(status: "running", claim_generation: 1, attempt_id: SecureRandom.uuid,
      lease_expires_at: 30.seconds.from_now, execution_deadline: 2.minutes.from_now)
    result = Interviews::AcceptTurnService.call(**input.merge(operation: next_turn, attempt_id: next_turn.attempt_id))
    expect(result).to be_success
    expect(interview.reload.status).to eq("completed")
    expect(question.reload.accepted_answer_count).to eq(2)
    expect(interview.messages.pluck(:kind)).to eq(%w[opening answer follow_up answer closing])
    expect(interview.messages.last.content).to eq("Thank you. This interview is complete.")
  end

  context "with a two-question service fixture" do
    let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), question_count: 2).value }

    it "introduces the next saved opening once and completes on its final advance" do
      first_input = input.merge(decision: "advance", reply: "Discarded model transition")
      accepted = Interviews::AcceptTurnService.call(**first_input)
      expect(accepted).to be_success
      expect(interview.reload).to have_attributes(status: "active", current_question_position: 1)
      next_question = interview.questions.last
      expect(interview.messages.pluck(:kind)).to eq(%w[opening answer opening])
      expect(interview.messages.last).to have_attributes(question_id: next_question.id, content: next_question.content)
      expect(interview.operations.speech.where(message: interview.messages.last).count).to eq(1)
      expect(Interviews::AcceptTurnService.call(**first_input).value).to eq(accepted.value)
      expect(interview.messages.where(question: next_question, kind: "opening").count).to eq(1)

      turn = Interviews::SubmitTurnService.call(interview: interview, question_id: next_question.id,
        recording_id: ready_interview_recording(interview, question: next_question).id, expected_revision: 1, submission_key: "next-question").value
      turn.update!(status: "running", claim_generation: 1, attempt_id: SecureRandom.uuid,
        lease_expires_at: 30.seconds.from_now, execution_deadline: 2.minutes.from_now)
      final = Interviews::AcceptTurnService.call(**first_input.merge(operation: turn, attempt_id: turn.attempt_id))
      expect(final).to be_success
      expect(interview.reload.status).to eq("completed")
      expect(interview.messages.pluck(:kind)).to eq(%w[opening answer opening answer closing])
      expect(interview.questions.pluck(:accepted_answer_count)).to eq([ 1, 1 ])
    end
  end
  it "rejects conflicting acceptance and preserves saved results after the lease expires" do
    accepted = Interviews::AcceptTurnService.call(**input)
    expect(accepted).to be_success
    expect(Interviews::AcceptTurnService.call(**input.merge(transcript: "Different transcript"))).not_to be_success
    expect(Interviews::AcceptTurnService.call(**input.merge(attempt_id: SecureRandom.uuid))).not_to be_success
    travel 3.minutes do
      expect(Interviews::AcceptTurnService.call(**input)).to be_success
    end
    expect(interview.messages.count).to eq(3)
    expect(question.reload.accepted_answer_count).to eq(1)
  end

  it "rejects stale generations, attempts, leases, and revisions without accepting dialogue" do
    identities = input
    [ { claim_generation: 0 }, { claim_generation: 2 }, { attempt_id: SecureRandom.uuid } ].each do |change|
      expect(Interviews::AcceptTurnService.call(**identities.merge(change))).not_to be_success
    end
    operation.update!(lease_expires_at: 1.second.ago)
    expect(Interviews::AcceptTurnService.call(**identities)).not_to be_success
    operation.update!(lease_expires_at: 30.seconds.from_now, execution_deadline: 1.second.ago)
    expect(Interviews::AcceptTurnService.call(**identities)).not_to be_success
    operation.update!(execution_deadline: 2.minutes.from_now)
    interview.update!(revision: 1)
    expect(Interviews::AcceptTurnService.call(**identities)).not_to be_success
    expect(interview.messages.pluck(:kind)).to eq([ "opening" ])
    expect(question.reload).to have_attributes(accepted_answer_count: 0, model_history: [])
  end

  it "rejects unsupported or oversized history and invalid transcript/decision without writes" do
    [ { history_version: 2 }, { model_history: {} }, { model_history: [ "not a message" ] },
      { model_history: [ { "content" => "x" * 262_144 } ] }, { transcript: " " },
      { transcript: "x" * (TextLimits::PROSE + 1) }, { decision: "skip" }, { reply: nil } ].each do |change|
      expect(Interviews::AcceptTurnService.call(**input.merge(change))).not_to be_success
    end
    expect(interview.messages.count).to eq(1)
    expect(operation.reload.status).to eq("running")
  end

  it "rolls back dialogue, history, counts, and advancement if speech creation fails" do
    interview.questions.create!(position: 1, content: "What did you learn?", question_type: "behavioral")
    acceptance = input
    allow_any_instance_of(InterviewSessionOperation).to receive(:save!).and_wrap_original do |save, *args|
      record = save.receiver
      if record.speech?
        record.errors.add(:base, "injected speech write failure")
        raise ActiveRecord::RecordInvalid, record
      end
      save.call(*args)
    end
    result = Interviews::AcceptTurnService.call(**acceptance.merge(decision: "advance", reply: nil))
    expect(result).not_to be_success
    expect(interview.reload).to have_attributes(status: "active", revision: 0, completed_at: nil)
    expect(question.reload).to have_attributes(accepted_answer_count: 0, model_history: [])
    expect(interview.messages.pluck(:kind)).to eq([ "opening" ])
    expect(operation.reload.status).to eq("running")
  end
  it "reports excessively nested history as invalid instead of raising" do
    nested = 110.times.reduce("text") { |value, _| [ value ] }
    result = Interviews::AcceptTurnService.call(**input.merge(model_history: [ { "parts" => nested } ]))
    expect(result).not_to be_success
    expect(interview.messages.count).to eq(1)
  end

  it "ignores JSON object key ordering when resolving an accepted receipt" do
    first = Interviews::AcceptTurnService.call(**input)
    reordered = input[:model_history].map { |message| message.to_a.reverse.to_h }
    expect(Interviews::AcceptTurnService.call(**input.merge(model_history: reordered)).value).to eq(first.value)
  end

  it "refuses acceptance after interview expiry without consuming an answer" do
    accepted_input = input
    interview.update!(expires_at: 1.second.ago)
    expect(Interviews::AcceptTurnService.call(**accepted_input)).not_to be_success
    expect(question.reload.accepted_answer_count).to eq(0)
    expect(interview.messages.count).to eq(1)
  end
end
