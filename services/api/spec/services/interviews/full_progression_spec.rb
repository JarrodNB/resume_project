# Proves saved legacy interviews and longer configured sessions keep complete progression.
require "rails_helper"

RSpec.describe "Complete prepared interview" do
  # These scenarios exercise the retained provider-speech path explicitly.
  before do
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
  end

  let(:question_count) { 9 }
  let(:interview) do
    session = Interviews::StartPreparationService.call(user: create(:user, summary: "Maintain instruments"),
      setup: { question_count: question_count == 9 ? 8 : question_count }).value
    if question_count == 9
      InterviewSession.where(id: session.id).update_all(setup_config: {}) # Represents a pre-configuration session.
      session.reload
    end
    preparation = session.operations.first
    expect(Interviews::ClaimOperationService.call(operation: preparation, execution_mode: "real")).to be_success
    result = Interviews::AcceptPreparationService.call(operation: preparation, attempt_id: preparation.attempt_id,
      claim_generation: preparation.claim_generation,
      role: { "title" => "Fictional technician", "responsibilities" => [ "Maintain instruments" ], "requirements" => [ "Calibration" ] },
      questions: question_count.times.map { |i| { "question_type" => %w[behavioral technical knowledge][i % 3], "content" => "Instrument topic #{i}?" } })
    expect(result).to be_success
    expect(Interviews::BeginService.call(interview: session)).to be_success
    session
  end

  def answer(session, decision: "continue")
    question = session.questions.find_by!(position: session.current_question_position)
    operation = Interviews::SubmitTurnService.call(interview: session, question_id: question.id,
      recording_id: ready_interview_recording(session, question: question).id,
      expected_revision: session.revision, submission_key: SecureRandom.uuid).value
    operation.update!(status: "running", attempt_id: SecureRandom.uuid, claim_generation: 1,
      lease_expires_at: 30.seconds.from_now, execution_deadline: 2.minutes.from_now)
    input = { operation: operation, attempt_id: operation.attempt_id, claim_generation: 1,
      transcript: "I checked the instrument.", decision: decision, reply: decision == "continue" ? "How did you check it?" : nil }
    first = Interviews::AcceptTurnService.call(**input)
    expect(first).to be_success
    expect(Interviews::AcceptTurnService.call(**input).value).to eq(first.value)
    session.reload
  end

  it "forces advancement at three through all nine and saves exactly one closing" do
    9.times do |position|
      2.times do
        answer(interview)
        expect(interview).to have_attributes(status: "active", current_question_position: position)
      end
      answer(interview)
      expect(interview.current_question_position).to eq([ position + 1, 8 ].min)
    end
    expect(interview).to be_completed
    expect(interview.questions.pluck(:accepted_answer_count)).to eq([ 3 ] * 9)
    expect(interview.messages.where(kind: "opening").count).to eq(9)
    expect(interview.messages.where(kind: "closing").count).to eq(1)
    expect(interview.messages.where(kind: "follow_up").count).to eq(18)
    expect(interview.operations.speech.count).to eq(28)
    expect(Interviews::BeginService.call(interview: interview)).to be_success
    expect(interview.messages.where(kind: "opening").count).to eq(9)
  end

  it "allows early advancement on every prepared question" do
    9.times { answer(interview, decision: "advance") }
    expect(interview).to be_completed
    expect(interview.questions.pluck(:accepted_answer_count)).to eq([ 1 ] * 9)
    expect(interview.messages.pluck(:kind)).to eq([ "opening" ] + [ "answer", "opening" ] * 8 + [ "answer", "closing" ])
  end

  it "preserves old sessions' two-response cap" do
    legacy = Interviews::CreateFixtureService.call(user: create(:user)).value
    2.times { answer(legacy) }
    expect(legacy).to have_attributes(status: "completed", answer_cap: 2)
    expect(legacy.questions.first.accepted_answer_count).to eq(2)
  end

  context "with twelve configured main questions" do
    let(:question_count) { 12 }

    it "reaches the final question with all earlier groups and completes once" do
      session = interview
      11.times { answer(session, decision: "advance") }
      question = session.questions.find_by!(position: 11)
      operation = Interviews::SubmitTurnService.call(interview: session, question_id: question.id,
        recording_id: ready_interview_recording(session, question: question).id,
        expected_revision: session.revision, submission_key: "last-of-twelve").value
      claim = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
      expect(claim).to be_success
      expect(session.messages.answer.count).to eq(11)
      expect(claim.value.fetch(:payload)).not_to have_key(:earlier_dialogue)
      result = Interviews::AcceptTurnService.call(operation: operation, attempt_id: operation.attempt_id,
        claim_generation: operation.claim_generation, transcript: "I maintained instruments.",
        decision: "advance", reply: nil)
      expect(result).to be_success
      expect(session.reload).to be_completed
      expect(session.messages.where(kind: "closing").count).to eq(1)
    end
  end

  it "claims only identities and choices for prepared turns" do
    session = interview
    question = session.questions.first
    operation = Interviews::SubmitTurnService.call(interview: session, question_id: question.id,
      recording_id: ready_interview_recording(session).id, expected_revision: session.revision, submission_key: "context").value
    result = Interviews::ClaimOperationService.call(operation: operation, execution_mode: "real")
    expect(result).to be_success
    expect(result.value.fetch(:payload)).to include(interview_id: session.id, user_id: session.user_id)
    expect(result.value.fetch(:payload).keys).to match_array([ :version, :interview_id, :user_id, :setup ])
  end
end
