# Description: Deleting a job keeps its AI tasks (their cost still counts toward the budget).
require "rails_helper"

RSpec.describe Job do
  it "detaches its AI tasks instead of deleting them" do
    job = create(:job)
    ai_task = create(:ai_task, user: job.user, subject: job, status: "completed", cost_microdollars: 1_500)

    job.destroy!

    expect(ai_task.reload).to have_attributes(subject_id: nil, subject_type: nil, cost_microdollars: 1_500)
  end
end
