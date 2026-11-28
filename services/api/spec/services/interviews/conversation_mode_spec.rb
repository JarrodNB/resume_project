# Checks the turn-based or live choice saved when preparation starts.
require "rails_helper"

RSpec.describe "Interview conversation mode" do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }

  it "defaults new and existing sessions to turn-based" do
    interview = Interviews::StartPreparationService.call(user: user).value
    expect(interview.reload.conversation_mode).to eq("turn_based")
    expect(Interviews::CreateFixtureService.call(user: user).value.conversation_mode).to eq("turn_based")
  end

  it "saves a live choice for five questions and refuses eight or twelve" do
    live = Interviews::StartPreparationService.call(user: user, conversation_mode: "live", setup: { question_count: 5 })
    expect(live).to be_success
    expect(live.value.reload.conversation_mode).to eq("live")
    [ 8, 12 ].each do |count|
      refused = Interviews::StartPreparationService.call(user: user, conversation_mode: "live", setup: { question_count: count })
      expect(refused.errors.join).to include("Live interviews use 5 questions")
    end
    expect(Interviews::StartPreparationService.call(user: user, conversation_mode: "video")).not_to be_success
    expect(user.interview_sessions.count).to eq(1)
  end

  it "gives a live start with no setup five questions and keeps eight for turn-based" do
    expect(Interviews::StartPreparationService.call(user: user, conversation_mode: "live").value.setup_config["question_count"]).to eq(5)
    expect(Interviews::StartPreparationService.call(user: user).value.setup_config["question_count"]).to eq(8)
  end

  it "keeps the mode readonly and enforces supported values in the database" do
    interview = Interviews::StartPreparationService.call(user: user, conversation_mode: "live").value
    expect { interview.update!(conversation_mode: "turn_based") }.to raise_error(ActiveRecord::ReadonlyAttributeError)
    expect(interview.reload.conversation_mode).to eq("live")
    expect { InterviewSession.where(id: interview.id).update_all(conversation_mode: "video") }.to raise_error(ActiveRecord::StatementInvalid)
  end
end
