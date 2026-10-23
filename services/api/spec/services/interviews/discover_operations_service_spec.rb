# Expired work is retired before discovery so it cannot hold the active answer slot.
require "rails_helper"

RSpec.describe Interviews::DiscoverOperationsService do
  it "does not discover old real speech reservations in browser mode" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    InterviewSession.where(id: interview.id).update_all(execution_mode: "real", execution_config: Interviews::ExecutionConfiguration::REAL)
    speech = interview.operations.speech.first
    expect(described_class.call(execution_mode: "real").value).not_to include(speech.id)
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).not_to be_success
    expect(speech.reload.execution_count).to eq(0)
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
    expect(described_class.call(execution_mode: "real").value).to include(speech.id)
  end

  it "expires an old recording and its logical task, allowing a fresh submission" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    input = { interview: interview, question_id: interview.questions.first.id, recording_id: ready_interview_recording(interview).id,
      expected_revision: 0, submission_key: "old" }
    operation = Interviews::SubmitTurnService.call(**input).value
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    travel 1.hour + 1.second
    expect(described_class.call).to be_success
    expect(operation.reload).to have_attributes(status: "expired", failure_code: "media_expired")
    expect(operation.ai_task.reload).to be_failed
    expect(Interviews::SubmitTurnService.call(**input.merge(recording_id: ready_interview_recording(interview).id, submission_key: "fresh"))).to be_success
    expect(Interviews::OperationStatusService.call(operation: operation).value[:status]).to eq("expired")
  end

  it "returns at most ten eligible IDs without returning current leased work" do
    user = create(:user)
    stub_const("DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS", 20)
    interviews = 12.times.map { Interviews::CreateFixtureService.call(user: user).value }
    leased = interviews.first.operations.first
    expect(Interviews::ClaimOperationService.call(operation: leased)).to be_success
    ids = described_class.call.value
    expect(ids.length).to eq(10)
    expect(ids).not_to include(leased.id)
  end
end
