# Starting a new preparation with the same setup as an earlier interview: Rails copies the setup,
# saved job and career focus itself, so nothing the browser sends can drift from the original.
require "rails_helper"

RSpec.describe Interviews::StartFromInterviewService do
  let(:user) { create(:user, summary: "I maintain laboratory instruments.") }
  let(:setup) { { "question_count" => 5, "question_format" => "behavioral", "difficulty" => "stretch", "interviewer" => "maya", "focus_areas" => [ "leadership" ] } }

  before { allow(Interviews::RuntimeReadiness).to receive(:ready?).and_return(true) }

  def live_source(**options)
    Interviews::StartPreparationService.call(user: user, setup: setup, conversation_mode: "live", **options).value
  end

  it "starts a turn-based preparation with the source's setup and career focus" do
    source = live_source(career_focus: "Laboratory automation")
    result = described_class.call(user: user, source: source)
    expect(result).to be_success
    expect(result.value).to have_attributes(conversation_mode: "turn_based", status: "preparing", setup_config: source.setup_config,
      career_focus: "Laboratory automation", job: nil, preparation_kind: "fictional_role")
    expect(result.value).not_to eq(source)
  end

  it "keeps the source's saved job" do
    job = create(:job, user: user)
    source = live_source(job: job)
    result = described_class.call(user: user, source: source)
    expect(result.value).to have_attributes(job: job, preparation_kind: "saved_job")
  end

  it "refuses when the source's saved job was deleted, instead of starting a different interview" do
    job = create(:job, user: user)
    source = live_source(job: job)
    job.destroy!
    result = described_class.call(user: user, source: source.reload)
    expect(result).not_to be_success
    expect(result.errors.join).to include("saved job for this interview was deleted")
    expect(user.interview_sessions.count).to eq(1)
  end

  describe "leaving an unfinished live session for the turn-based fallback" do
    around { |example| with_livekit_env { example.run } }

    it "abandons a live session whose room was never joined, in the same request" do
      source = ready_live_interview(user)
      result = described_class.call(user: user, source: source)
      expect(result).to be_success
      expect(source.reload.status).to eq("abandoned")
      expect(result.value.reload.status).to eq("preparing")
    end

    it "ends a joined room as failed by the usual finish rule" do
      source = ready_live_interview(user)
      Interviews::JoinLiveService.call(interview: source)
      expect(described_class.call(user: user, source: source)).to be_success
      expect(source.live_connections.sole).to have_attributes(status: "ended", end_reason: "failed")
      expect(source.reload.status).to eq("abandoned")
    end

    it "leaves a finished live session and the live session of a refused start as they are" do
      finished = ready_live_interview(user)
      finished.update_columns(status: "completed")
      expect(described_class.call(user: user, source: finished)).to be_success
      expect(finished.reload.status).to eq("completed")
      job = create(:job, user: user)
      refused = live_source(job: job)
      job.destroy!
      expect(described_class.call(user: user, source: refused.reload)).not_to be_success
      expect(refused.reload.status).to eq("preparing")
    end
  end

  it "refuses someone else's interview as not found" do
    source = live_source
    result = described_class.call(user: create(:user), source: source)
    expect(result).not_to be_success
    expect(result.errors).to eq([ "Record not found" ])
  end
end
