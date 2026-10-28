# Description: Deleting a job keeps its AI tasks (their cost still counts toward the budget).
require "rails_helper"

RSpec.describe Job do
  it "detaches its AI tasks instead of deleting them" do
    job = create(:job)
    ai_task = create(:ai_task, user: job.user, subject: job, status: "completed", cost_microdollars: 1_500)

    job.destroy!

    expect(ai_task.reload).to have_attributes(subject_id: nil, subject_type: nil, cost_microdollars: 1_500)
  end

  it "deletes its gap responses and keeps library career_contexts" do
    job = create(:job)
    context = create(:career_context, user: job.user)
    create(:job_gap_response, job: job, career_context: context)

    job.destroy!

    expect(JobGapResponse.count).to eq(0)
    expect(CareerContext.exists?(context.id)).to be(true)
  end
end
