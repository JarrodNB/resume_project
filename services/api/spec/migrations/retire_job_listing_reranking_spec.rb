# Retirement preserves completed results, billing, and unrelated queued work.
require "rails_helper"
require Rails.root.join("db/migrate/20261124010000_retire_job_listing_reranking")

RSpec.describe RetireJobListingReranking do
  it "retires pending reranking while preserving history and other tasks" do
    pending = %w[queued needs_user_input].map do |status|
      create(:ai_task, task_type: "rerank_job_listings", status: status, cost_microdollars: 123)
    end
    completed = create(:ai_task, task_type: "rerank_job_listings", status: "completed", cost_microdollars: 456)
    unrelated = create(:ai_task, task_type: "parse_resume")

    ActiveRecord::Migration.suppress_messages { 2.times { described_class.new.migrate(:up) } }

    pending.each do |task|
      expect(task.reload).to have_attributes(status: "failed", cost_microdollars: 123, awaiting_queue_publish: false)
    end
    expect(completed.reload).to have_attributes(status: "completed", cost_microdollars: 456)
    expect(unrelated.reload).to be_queued
  end
end
