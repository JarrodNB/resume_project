# Starting a new preparation with the same setup as an earlier interview: Rails copies the setup,
# saved job and career focus itself, so nothing the browser sends can drift from the original.
require "rails_helper"

RSpec.describe Interviews::StartFromInterviewService do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }
  let(:setup) { { "question_count" => 5, "question_format" => "behavioral", "difficulty" => "stretch", "interviewer" => "maya", "focus_areas" => [ "leadership" ] } }

  def live_source(**options)
    Interviews::StartPreparationService.call(user: user, setup: setup, conversation_mode: "live", **options).value
  end

  it "starts a turn-based preparation with the source's setup and career focus" do
    source = live_source(career_focus: "Laboratory automation")
    result = described_class.call(user: user, source: source, conversation_mode: "turn_based")
    expect(result).to be_success
    expect(result.value).to have_attributes(conversation_mode: "turn_based", status: "preparing", setup_config: source.setup_config,
      career_focus: "Laboratory automation", job: nil, preparation_kind: "fictional_role")
    expect(result.value).not_to eq(source)
  end

  it "keeps the source's saved job" do
    job = create(:job, user: user)
    source = live_source(job: job)
    result = described_class.call(user: user, source: source, conversation_mode: "turn_based")
    expect(result.value).to have_attributes(job: job, preparation_kind: "saved_job")
  end

  it "refuses when the source's saved job was deleted, instead of starting a different interview" do
    job = create(:job, user: user)
    source = live_source(job: job)
    job.destroy!
    result = described_class.call(user: user, source: source.reload, conversation_mode: "turn_based")
    expect(result).not_to be_success
    expect(result.errors.join).to include("saved job for this interview was deleted")
    expect(user.interview_sessions.count).to eq(1)
  end

  it "refuses someone else's interview as not found" do
    source = live_source
    result = described_class.call(user: create(:user), source: source, conversation_mode: "turn_based")
    expect(result).not_to be_success
    expect(result.errors).to eq([ "Record not found" ])
  end
end
