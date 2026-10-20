# Checks the persisted interview type rather than relying on a controller default.
require "rails_helper"

RSpec.describe "Interview types" do
  it "defaults a new session and the Basic fixture to the basic type" do
    expect(InterviewSession.new.interview_type).to eq("basic")
    session = Interviews::CreateFixtureService.call(user: create(:user)).value
    expect(session.reload.interview_type).to eq("basic")
  end

  it "rejects unsupported types instead of implying they are implemented" do
    session = Interviews::CreateFixtureService.call(user: create(:user)).value
    session.interview_type = "complex"
    expect(session).not_to be_valid
    expect(session.errors[:interview_type]).to be_present
  end
  it "enforces the required basic-only discriminator in the database" do
    session = Interviews::CreateFixtureService.call(user: create(:user)).value
    expect do
      ActiveRecord::Base.transaction(requires_new: true) { session.update_columns(interview_type: "complex") }
    end.to raise_error(ActiveRecord::StatementInvalid)
    expect do
      ActiveRecord::Base.transaction(requires_new: true) { session.update_columns(interview_type: nil) }
    end.to raise_error(ActiveRecord::NotNullViolation)
    expect(session.reload.interview_type).to eq("basic")
  end
end
