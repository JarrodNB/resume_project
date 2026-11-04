# Description: Dismissing and restoring one requirement of a job, and how that meets saved answers.
require "rails_helper"

RSpec.describe GapResponses::SetGapDismissalService do
  let(:job) { create(:job) }
  let(:requirement) { "Experience with Kubernetes" }

  def set_dismissed(dismissed, text: requirement)
    described_class.call(job: job, requirement: text, dismissed: dismissed)
  end

  it "dismisses a requirement and is safe to run twice" do
    2.times { expect(set_dismissed(true)).to be_success }

    expect(job.gap_dismissals.pluck(:requirement)).to eq([ requirement ])
  end

  it "restores a requirement and is safe to run twice" do
    create(:job_gap_dismissal, job: job, requirement: requirement)

    2.times { expect(set_dismissed(false)).to be_success }

    expect(job.gap_dismissals).to be_empty
  end

  it "refuses to dismiss a requirement with a saved answer" do
    create(:job_gap_response, job: job, requirement: requirement)

    result = set_dismissed(true)

    expect(result).not_to be_success
    expect(result.errors).to eq([ "Clear your details for this requirement before dismissing it" ])
    expect(job.gap_dismissals).to be_empty
  end

  it "rejects a blank requirement" do
    expect(set_dismissed(true, text: " ")).not_to be_success
  end

  it "is removed when an answer is saved for that requirement" do
    create(:job_gap_dismissal, job: job, requirement: requirement)

    GapResponses::SaveGapResponseService.call(job: job, requirement: requirement, body: "Led the Acme cluster move", add_to_library: false)

    expect(job.gap_dismissals).to be_empty
  end
end
