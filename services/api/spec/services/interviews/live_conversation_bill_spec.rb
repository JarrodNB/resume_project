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
end
