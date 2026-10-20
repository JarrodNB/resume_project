# Exercises persisted fixture creation without HTTP, queues, or providers.
require "rails_helper"

RSpec.describe "Basic Interview fixture creation" do
  it "saves the opening and its pending speech with a frozen fictional context" do
    user = create(:user)
    result = BasicInterviews::CreateFixtureService.call(user: user)
    expect(result).to be_success
    interview = result.value
    expect(user.basic_interviews).to include(interview)
    expect(interview.questions.count).to eq(1)
    expect(interview.messages.pluck(:kind, :content)).to eq([ [ "opening", interview.questions.first.content ] ])
    expect(interview.operations.sole).to have_attributes(kind: "speech", status: "pending", message_id: interview.messages.sole.id)
    expect(interview.fixture_context).to include("synthetic" => true)
    expect(interview.expires_at).to be_within(5.seconds).of(7.days.from_now)
  end
  it "rolls back the fixture if its first speech operation cannot be saved" do
    user = create(:user)
    allow_any_instance_of(BasicInterviewOperation).to receive(:save!).and_wrap_original do |save, *args|
      record = save.receiver
      record.errors.add(:base, "injected opening speech failure")
      raise ActiveRecord::RecordInvalid, record
    end
    result = BasicInterviews::CreateFixtureService.call(user: user)
    expect(result).not_to be_success
    expect(user.basic_interviews.count).to eq(0)
  end

  it "only permits the one-question demo or the two-question verification fixture" do
    expect(BasicInterviews::CreateFixtureService.call(user: create(:user), question_count: 3)).not_to be_success
  end
end
