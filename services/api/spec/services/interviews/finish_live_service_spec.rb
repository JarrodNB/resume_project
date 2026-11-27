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

    it "refuses an interview that never opened a room" do
      result = described_class.for_owner(interview: ready_live_interview(user))
      expect(result).not_to be_success
      expect(result.errors).to eq([ "This interview has no live room" ])
    end
  end
end
