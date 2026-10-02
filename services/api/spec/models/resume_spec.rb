# Description: Resume validations: a tailored resume needs a job only when it is created.
require "rails_helper"

RSpec.describe Resume do
  it "requires a job when creating a tailored resume" do
    resume = build(:resume, kind: "tailored", job: nil)

    expect(resume).not_to be_valid
    expect(resume.errors.full_messages).to eq([ "Job can't be blank" ])
  end

  it "stays valid after its job is deleted" do
    resume = create(:resume, :tailored)

    resume.job.destroy!

    expect(resume.reload.job).to be_nil
    expect(resume.update(title: "Renamed")).to be(true)
  end
end
