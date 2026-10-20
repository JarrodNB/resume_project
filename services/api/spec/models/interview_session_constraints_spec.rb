# Bypasses model validation deliberately to verify Postgres is the final invariant boundary.
require "rails_helper"

RSpec.describe "Basic Interview database invariants" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:question) { interview.questions.first }
  before { question }

  def expect_constraint(error = ActiveRecord::StatementInvalid)
    expect do
      ActiveRecord::Base.transaction(requires_new: true) { yield }
    end.to raise_error(error)
  end

  it "requires turn inputs including revision, and coherent running and accepted identities" do
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: 0, submission_key: "one").value
    expect_constraint { turn.update_columns(expected_revision: nil) }
    expect_constraint { turn.update_columns(status: "running") }
    expect_constraint { turn.update_columns(status: "accepted") }
    expect_constraint { turn.update_columns(claim_generation: -1) }
  end

  it "protects the active turn slot and submission identity without model validations" do
    turn = Interviews::SubmitTurnService.call(interview: interview, question_id: question.id,
      recording_id: ready_interview_recording(interview).id, expected_revision: 0, submission_key: "one").value
    duplicate = turn.dup
    duplicate.submission_key = "different"
    expect_constraint(ActiveRecord::RecordNotUnique) { duplicate.save!(validate: false) }
    turn.update!(status: "failed")
    duplicate = turn.dup
    expect_constraint(ActiveRecord::RecordNotUnique) { duplicate.save!(validate: false) }
  end

  it "prevents duplicate opening, semantic identity, message sequence, and speech work" do
    opening = interview.messages.sole
    duplicate = opening.dup
    duplicate.position = 1
    duplicate.semantic_key = "another-opening"
    expect_constraint(ActiveRecord::RecordNotUnique) { duplicate.save!(validate: false) }
    duplicate.kind = "follow_up"
    duplicate.semantic_key = opening.semantic_key
    expect_constraint(ActiveRecord::RecordNotUnique) { duplicate.save!(validate: false) }
    duplicate.semantic_key = "different"
    duplicate.position = 0
    expect_constraint(ActiveRecord::RecordNotUnique) { duplicate.save!(validate: false) }
    expect_constraint(ActiveRecord::RecordNotUnique) { interview.operations.sole.dup.save!(validate: false) }
  end

  it "rejects negative or excessive counters and non-array accepted history" do
    expect_constraint { question.update_columns(accepted_answer_count: 3) }
    expect_constraint { question.update_columns(accepted_answer_count: -1) }
    expect_constraint { question.update_columns(model_history: {}) }
    expect_constraint { question.update_columns(history_version: 0) }
    expect_constraint { interview.update_columns(answer_cap: 3) }
    expect_constraint { interview.update_columns(revision: -1) }
  end

  it "prevents a foreign question or mismatched message from crossing interview boundaries" do
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value
    foreign.operations.speech.destroy_all
    expect_constraint(ActiveRecord::InvalidForeignKey) { interview.messages.sole.update_columns(question_id: foreign.questions.first.id, kind: "follow_up") }
    expect_constraint(ActiveRecord::InvalidForeignKey) { interview.operations.sole.update_columns(question_id: foreign.questions.first.id) }
    expect_constraint(ActiveRecord::InvalidForeignKey) { interview.operations.sole.update_columns(message_id: foreign.messages.first.id) }
  end

  it "binds private media to a non-null owned question and matching saved message" do
    media = InterviewSessionMedia.create!(interview_session: interview, question: question,
      operation: interview.operations.sole, message: interview.messages.sole, kind: "speech", content_type: "audio/wav",
      attempt_id: SecureRandom.uuid, claim_generation: 1, expires_at: 1.hour.from_now)
    expect_constraint(ActiveRecord::CheckViolation) { media.update_columns(question_id: nil) }
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value
    expect_constraint(ActiveRecord::InvalidForeignKey) { media.update_columns(question_id: foreign.questions.first.id) }
    expect_constraint(ActiveRecord::InvalidForeignKey) { media.update_columns(message_id: foreign.messages.first.id) }
    expect_constraint(ActiveRecord::InvalidForeignKey) { media.update_columns(operation_id: foreign.operations.sole.id) }
  end
end
