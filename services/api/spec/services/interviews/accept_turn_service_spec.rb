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
