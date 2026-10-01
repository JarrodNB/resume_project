# Description: Stage changes and applied_at recording.
require "rails_helper"

RSpec.describe Jobs::MoveJobToStageService do
  it "sets applied_at the first time a job leaves unapplied" do
    job = create(:job)
    result = described_class.call(job: job, stage: "applied")

    expect(result).to be_success
    expect(job.reload).to be_applied
    expect(job.applied_at).to be_present
  end

  it "keeps the original applied_at on later moves" do
    applied_at = 3.days.ago.change(usec: 0)
    job = create(:job, stage: "applied", applied_at: applied_at)

    described_class.call(job: job, stage: "interviewing")

    expect(job.reload.applied_at).to eq(applied_at)
  end

  it "fails for an unknown stage" do
    result = described_class.call(job: create(:job), stage: "ghosted")
    expect(result).not_to be_success
    expect(result.errors).not_to be_empty
  end
end
