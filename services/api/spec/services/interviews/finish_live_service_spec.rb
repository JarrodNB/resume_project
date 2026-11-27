# The owner's entry point to finishing a live interview: which room it ends and why.
require "rails_helper"

RSpec.describe Interviews::FinishLiveService do
  let(:user) { create(:user) }

  around { |example| with_livekit_env { example.run } }

  describe ".for_owner" do
    it "ends the interview's open room for the candidate" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      result = described_class.for_owner(interview: interview)
      expect(result).to be_success
      expect(interview.live_connections.sole).to have_attributes(status: "ended", end_reason: "ended_by_candidate")
    end

    it "ends the room as failed when the candidate leaves an unavailable live room" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      expect(described_class.for_owner(interview: interview, live_unavailable: true)).to be_success
      expect(interview.live_connections.sole.end_reason).to eq("failed")
    end

    it "refuses an interview that is no longer active with a message only, never the agent's internal code" do
      interview = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: interview)
      interview.update_columns(status: "completed") # finished another way while its room stayed open
      result = described_class.for_owner(interview: interview)
      expect(result).not_to be_success
      expect(result).to have_attributes(errors: [ "Interview is not active" ], code: nil)
    end

    it "abandons a live interview whose first join was refused, so it never stays resumable" do
      interview = ready_live_interview(user)
      with_livekit_env(LiveInterviewHelpers::LIVEKIT_TEST_ENV.transform_values { "" }) { Interviews::JoinLiveService.call(interview: interview) } # not configured
      expect(interview.reload.status).to eq("ready")
      result = described_class.for_owner(interview: interview, live_unavailable: true)
      expect(result).to be_success
      expect(result.value).to include(status: "abandoned")
      expect(interview.reload.status).to eq("abandoned")
      expect(described_class.for_owner(interview: interview)).to be_success # a repeat changes nothing
    end

    it "refuses a turn-based interview, which never has a live room" do
      interview = ready_live_interview(user, conversation_mode: "turn_based")
      result = described_class.for_owner(interview: interview)
      expect(result).not_to be_success
      expect(result.errors).to eq([ "This interview has no live room" ])
      expect(interview.reload.status).to eq("ready")
    end
  end
end
