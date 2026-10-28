# Expiry maintenance frees stale answer slots without discovering executable work.
require "rails_helper"

RSpec.describe "Interview expiry maintenance" do
  let(:storage) { instance_double(Interviews::MediaStorage, delete: nil) }

  it "keeps provider-disabled speech fenced at the claim seam" do
    interview = Interviews::CreateFixtureService.call(user: create(:user), execution_mode: "real").value
    speech = interview.operations.first
    expect(speech.delivery_job_id).to be_nil
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).not_to be_success
    expect(speech.reload.execution_count).to eq(0)
    allow(ENV).to receive(:[]).and_call_original
    allow(ENV).to receive(:[]).with("INTERVIEW_SPEECH_PLAYBACK").and_return("provider")
    expect(Interviews::ClaimOperationService.call(operation: speech, execution_mode: "real")).to be_success
  end

  it "expires an old recording and its logical task, allowing a fresh submission" do
    interview = Interviews::CreateFixtureService.call(user: create(:user)).value
    input = { interview: interview, question_id: interview.questions.first.id, recording_id: ready_interview_recording(interview).id,
      expected_revision: 0, submission_key: "old" }
    operation = Interviews::SubmitTurnService.call(**input).value
    expect(Interviews::ClaimOperationService.call(operation: operation)).to be_success
    travel 1.hour + 1.second
    expect(Interviews::CleanupService.call(storage: storage)).to be_success
    expect(operation.reload).to have_attributes(status: "expired", failure_code: "media_expired")
    expect(operation.ai_task.reload).to be_failed
    expect(Interviews::SubmitTurnService.call(**input.merge(recording_id: ready_interview_recording(interview).id, submission_key: "fresh"))).to be_success
  end

  it "bounds each expiry batch without retiring live work" do
    user = create(:user)
    expired = 12.times.map do
      interview = Interviews::CreateFixtureService.call(user: user).value
      interview.update!(status: "completed", completed_at: 1.hour.ago - 1.second)
      interview.operations.first
    end
    live = Interviews::CreateFixtureService.call(user: user).value.operations.first
    Interviews::CleanupService.call(limit: 10, storage: storage)
    expect(expired.count { |operation| operation.reload.expired? }).to eq(10)
    expect(live.reload).to be_pending
  end
end
