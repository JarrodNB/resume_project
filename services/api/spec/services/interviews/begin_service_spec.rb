# Exercises explicit begin through saved role review, without running any providers.
require "rails_helper"

RSpec.describe "Explicit interview begin" do
  let(:interview) { Interviews::StartPreparationService.call(user: create(:user, summary: "Laboratory work")).value }

  def prepare
    interview.questions.create!(content: "Explain calibration", position: 0)
    interview.update!(status: "ready", prepared_role: { title: "Fictional technician" }, revision: 1)
  end

  it "requires ready state, then saves opening and speech exactly once across replay" do
    expect(Interviews::BeginService.call(interview: interview)).not_to be_success
    prepare
    2.times { expect(Interviews::BeginService.call(interview: interview)).to be_success }
    expect(interview.reload).to have_attributes(status: "active", revision: 2, answer_cap: 3)
    expect(interview.messages.pluck(:kind, :content)).to eq([ [ "opening", "Explain calibration" ] ])
    expect(interview.operations.speech.count).to eq(1)
  end

  it "refuses expired role review without creating dialogue" do
    prepare
    interview.update!(expires_at: 1.second.ago)
    expect(Interviews::BeginService.call(interview: interview)).not_to be_success
    expect(interview.messages).to be_empty
  end
end
