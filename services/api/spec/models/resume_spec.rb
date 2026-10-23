# Description: Resume validations: a resume needs a job only when it is created.
require "rails_helper"

RSpec.describe Resume do
  it "requires a job when created" do
    resume = build(:resume, job: nil)

    expect(resume).not_to be_valid
    expect(resume.errors.full_messages).to eq([ "Job can't be blank" ])
  end

  it "defaults to two pages and constrains the target in the database" do
    resume = create(:resume)
    expect(resume.target_page_count).to eq(2)
    expect(resume.update(target_page_count: 3)).to be(false)
    expect do
      Resume.transaction(requires_new: true) { resume.update_columns(target_page_count: 3) }
    end.to raise_error(ActiveRecord::StatementInvalid, /resumes_target_page_count_allowed/)
    expect(resume.reload.target_page_count).to eq(2)
  end

  it "stays valid after its job is deleted" do
    resume = create(:resume)

    resume.job.destroy!

    expect(resume.reload.job).to be_nil
    expect(resume.update(title: "Renamed")).to be(true)
  end
end
