# Checks immutable submission identity and the single active answer slot through the service.
require "rails_helper"

RSpec.describe "Basic Interview submission" do
  let(:interview) { Interviews::CreateFixtureService.call(user: create(:user)).value }
  let(:input) do
    { interview: interview, question_id: interview.questions.first.id, recording_id: SecureRandom.uuid,
      expected_revision: 0, submission_key: "browser-request-1" }
  end

  it "persists a turn once and resolves the same fingerprint even after revision changes" do
    first = Interviews::SubmitTurnService.call(**input)
    expect(first).to be_success
    interview.update!(revision: 1)
    repeated = Interviews::SubmitTurnService.call(**input)
    expect(repeated).to be_success
    expect(repeated.value.id).to eq(first.value.id)
    expect(interview.operations.turn.count).to eq(1)
  end
  it "rejects changed recording, question, or revision under the same submission key" do
    expect(Interviews::SubmitTurnService.call(**input)).to be_success
    [ { recording_id: SecureRandom.uuid }, { question_id: SecureRandom.uuid }, { expected_revision: 1 } ].each do |change|
      result = Interviews::SubmitTurnService.call(**input.merge(change))
      expect(result).not_to be_success
      expect(result.errors).to include("Submission key conflicts with its original inputs")
    end
    expect(interview.operations.turn.count).to eq(1)
  end

  it "refuses another active turn and permits a new recording after a failed turn" do
    first = Interviews::SubmitTurnService.call(**input).value
    another = input.merge(submission_key: "other-key", recording_id: SecureRandom.uuid)
    expect(Interviews::SubmitTurnService.call(**another)).not_to be_success
    first.update!(status: "failed")
    expect(Interviews::SubmitTurnService.call(**another)).to be_success
    expect(interview.questions.first.accepted_answer_count).to eq(0)
  end

  it "rejects stale revisions, non-current or foreign questions, and inactive or expired sessions" do
    expect(Interviews::SubmitTurnService.call(**input.merge(expected_revision: 1))).not_to be_success
    foreign = Interviews::CreateFixtureService.call(user: create(:user)).value.questions.first
    expect(Interviews::SubmitTurnService.call(**input.merge(question_id: foreign.id))).not_to be_success
    interview.update!(expires_at: 1.second.ago)
    expect(Interviews::SubmitTurnService.call(**input)).not_to be_success
    interview.update!(expires_at: 1.day.from_now, status: "completed")
    expect(Interviews::SubmitTurnService.call(**input)).not_to be_success
    expect(interview.operations.turn.count).to eq(0)
  end

  it "reports malformed identities without a database exception" do
    [ { submission_key: " " }, { submission_key: "x" * 201 }, { recording_id: "not-a-uuid" },
      { expected_revision: "0" }, { question_id: nil } ].each do |change|
      expect(Interviews::SubmitTurnService.call(**input.merge(change))).not_to be_success
    end
  end
end
