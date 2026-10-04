# Description: Resume validations: a resume needs a job only when it is created.
require "rails_helper"

RSpec.describe Resume do
  it "requires a job when created" do
    resume = build(:resume, job: nil)

    expect(resume).not_to be_valid
    expect(resume.errors.full_messages).to eq([ "Job can't be blank" ])
  end

  it "stays valid after its job is deleted" do
    resume = create(:resume)

    resume.job.destroy!

    expect(resume.reload.job).to be_nil
    expect(resume.update(title: "Renamed")).to be(true)
  end
end
