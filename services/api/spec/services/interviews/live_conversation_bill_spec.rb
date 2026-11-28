# The live bill accepts only the two models the live agent uses. The AI service keeps the same
# names as fixed constants (services/ai/tests/test_model_prices.py checks the same values), so a
# changed name on one side fails a test instead of silently ending every live interview.
require "rails_helper"

RSpec.describe Interviews::LiveConversationBill do
  it "bills exactly the live agent's realtime and transcription models" do
    expect(described_class::MODELS).to eq([ "gpt-realtime-2.1-mini", "gpt-live-transcribe" ])
  end

  it "has a verification reservation for the realtime model, so a claim can open the bill" do
    expect(Interviews::VerificationBudget::RESERVATIONS).to have_key([ "live_conversation", "openai", described_class::REALTIME_MODEL ])
  end

  it "shares the session's preparation admission and fails closed when that admission is missing" do
    user = create(:user)
    interview = ready_live_interview(user)
    connection = with_livekit_env do
      Interviews::JoinLiveService.call(interview: interview)
      interview.reload.live_connections.sole
    end
    interview.operations.preparation.first.update!(ai_task: nil)

    result = Interviews::ClaimLiveConnectionService.call(connection: connection, room_name: connection.room_name)
    expect(result).not_to be_success
    expect(result.errors.join).to include("admission is invalid")
    expect(connection.reload).to have_attributes(status: "authorized", ai_task: nil)
    expect(user.ai_tasks.where(task_type: "interview_live_conversation")).to be_empty
  end
end
