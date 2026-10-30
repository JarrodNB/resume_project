# Exercises durable skipping without treating a skipped prompt as an answer.
require "rails_helper"

RSpec.describe Interviews::SkipQuestionService do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), question_count: 2).value }
  let(:question) { interview.questions.first }
  let(:input) { { interview: interview, question_id: question.id, expected_revision: 0, submission_key: "skip-1" } }

  it "does not generate closing speech after the final skip" do
    interview.questions.where.not(id: question.id).destroy_all
    expect(described_class.call(**input)).to be_success
    closing = interview.messages.closing.last!
    expect(interview.operations.speech.where(message: closing)).to be_empty
  end

  it "advances once, persists a skipped remainder and accepts an exact retry" do
    expect(described_class.call(**input)).to be_success
    expect(interview.reload.current_question_position).to eq(1)
    expect(question.reload.skipped_at).to be_present
    expect(question.accepted_answer_count).to eq(0)
    expect(interview.messages.last.kind).to eq("opening")
    expect(described_class.call(**input)).to be_success
    expect(interview.reload.revision).to eq(1)
    expect(described_class.call(**input.merge(question_id: interview.questions.last.id))).not_to be_success
  end
end

RSpec.describe "Skipping interview question cycles" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user), question_count: 2).value }
  let(:question) { interview.questions.first }
  let(:input) { { interview: interview, question_id: question.id, expected_revision: 0, submission_key: "skip-cycle" } }

  it "preserves an earlier answer and skips the follow-up remainder" do
    answer = interview.messages.create!(question: question, kind: "answer", position: 1, semantic_key: "previous-answer", content: "I led the project.")
    interview.messages.create!(question: question, kind: "follow_up", position: 2, semantic_key: "previous-follow-up", content: "What changed?")
    question.update!(accepted_answer_count: 1)
    expect(Interviews::SkipQuestionService.call(**input)).to be_success
    expect(answer.reload.content).to eq("I led the project.")
    expect(question.reload.accepted_answer_count).to eq(1)
    expect(interview.messages.where(kind: "follow_up").count).to eq(1)
    expect(interview.operations.turn.count).to eq(0)
  end

  it "completes the final cycle and replays without adding another closing" do
    interview.update!(current_question_position: 1)
    args = input.merge(question_id: interview.questions.last.id)
    expect(Interviews::SkipQuestionService.call(**args)).to be_success
    expect(interview.reload).to be_completed
    expect(interview.completed_at).to be_present
    expect(Interviews::SkipQuestionService.call(**args)).to be_success
    expect(interview.messages.where(kind: "closing").count).to eq(1)
  end

  it "rejects stale, foreign, non-current, malformed and changed duplicate inputs" do
    [ { expected_revision: 1 }, { question_id: interview.questions.last.id }, { question_id: SecureRandom.uuid },
      { question_id: nil }, { submission_key: " " }, { expected_revision: -1 } ].each do |change|
      expect(Interviews::SkipQuestionService.call(**input.merge(change))).not_to be_success
    end
    expect(Interviews::SkipQuestionService.call(**input)).to be_success
    expect(Interviews::SkipQuestionService.call(**input.merge(expected_revision: 1))).not_to be_success
    expect(interview.reload.revision).to eq(1)
  end

  it "rejects pending answer and transcription work without losing state" do
    operation = Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      expected_revision: 0, submission_key: "answer", transcription_mode: "typed", candidate_transcript: "My answer").value
    expect(Interviews::SkipQuestionService.call(**input)).not_to be_success
    expect(question.reload.skipped_at).to be_nil
    operation.update!(status: "failed")
    recording = ready_interview_recording(interview)
    interview.operations.create!(kind: "transcription", question: question, recording_id: recording.id, expected_revision: 0)
    expect(Interviews::SkipQuestionService.call(**input)).not_to be_success
    expect(interview.reload.revision).to eq(0)
  end

  it "rejects expired, inactive and abandoned sessions" do
    %w[preparing ready completed abandoned expired].each do |status|
      interview.update!(status: status)
      expect(Interviews::SkipQuestionService.call(**input)).not_to be_success
    end
    interview.update!(status: "active", expires_at: 1.second.ago)
    expect(Interviews::SkipQuestionService.call(**input)).not_to be_success
  end
end

RSpec.describe "Answering after skipping a follow-up" do
  it "claims the next core with a fresh history and complete earlier accepted dialogue" do
    interview = Interviews::CreateFixtureService.call(user: create(:user), question_count: 2).value
    question = interview.questions.first
    operation = Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      expected_revision: 0, submission_key: "first", transcription_mode: "typed", candidate_transcript: "I led it.").value
    claim = Interviews::ClaimOperationService.call(operation: operation).value
    expect(Interviews::AcceptTurnService.call(operation: operation, **claim.slice(:attempt_id, :claim_generation),
      transcript: "I led it.", decision: "continue", reply: "How?", history_version: 1,
      model_history: [ { "private" => "first question history" } ])).to be_success
    expect(Interviews::SkipQuestionService.call(interview: interview, question_id: question.id,
      expected_revision: 1, submission_key: "skip-follow-up")).to be_success
    next_question = interview.questions.last
    next_turn = Interviews::SubmitTurnService.call(interview: interview, question_id: next_question.id,
      expected_revision: 2, submission_key: "next", transcription_mode: "typed", candidate_transcript: "I prioritized.").value
    next_claim = Interviews::ClaimOperationService.call(operation: next_turn).value
    payload = next_claim.fetch(:payload)
    expect(payload).not_to have_key(:model_history)
    expect(interview.messages.where(question: next_question).pluck(:content)).to eq([ next_question.content ])
    expect(Interviews::EarlierDialogue.build(interview, before_position: next_question.position).fetch(:groups).first.fetch(:messages)).to eq([
      { kind: "opening", content: question.content }, { kind: "answer", content: "I led it." } ])
    expect(Interviews::AcceptTurnService.call(operation: next_turn, **next_claim.slice(:attempt_id, :claim_generation),
      transcript: "I prioritized.", decision: "advance", history_version: 1, model_history: [])).to be_success
    expect(interview.reload).to be_completed
    expect(interview.messages.where(kind: "answer").pluck(:content)).to eq([ "I led it.", "I prioritized." ])
  end
end
