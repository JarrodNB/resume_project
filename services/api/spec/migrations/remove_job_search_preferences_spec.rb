# Exercise the removal against the previous tables while retaining unrelated jobs and task charges.
require "rails_helper"
require Rails.root.join("db/migrate/20261029130001_create_job_preference_profiles")
require Rails.root.join("db/migrate/20261030150000_add_job_preference_screening_approvals")
require Rails.root.join("db/migrate/20261121010000_remove_job_search_preferences")

RSpec.describe RemoveJobSearchPreferences do
  it "removes preference storage and retires pending work without deleting saved jobs or billing" do
    user = create(:user)
    job = create(:job, user: user)
    pending = %w[elicit_job_preferences check_job_preferences].product(%w[queued needs_user_input]).map do |type, status|
      create(:ai_task, user: user, task_type: type, status: status, cost_microdollars: 123)
    end
    completed = create(:ai_task, user: user, task_type: "check_job_preferences", status: "completed", cost_microdollars: 456)
    unrelated = create(:ai_task, user: user, task_type: "rerank_job_listings")
    connection = ActiveRecord::Base.connection
    ActiveRecord::Migration.suppress_messages do
      CreateJobPreferenceProfiles.new.migrate(:up)
      AddJobPreferenceScreeningApprovals.new.migrate(:up)
      connection.execute("CREATE VIEW ai_generated_preference_criteria AS SELECT id FROM ai_tasks")
      described_class.new.migrate(:up)
    end

    expect(connection.table_exists?(:job_preference_profiles)).to be(false)
    expect(connection.columns(:job_board_listings).map(&:name)).not_to include("screened_sha256")
    expect(connection.view_exists?(:ai_generated_preference_criteria)).to be(false)
    pending.each do |task|
      expect(task.reload).to have_attributes(status: "failed", cost_microdollars: 123, pending_questions: [])
    end
    expect(completed.reload).to have_attributes(status: "completed", cost_microdollars: 456)
    expect(unrelated.reload).to be_queued
    expect(job.reload.user_id).to eq(user.id)
  end
end
