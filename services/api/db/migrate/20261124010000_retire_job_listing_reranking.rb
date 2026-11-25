# Stop pending reranking without deleting historical tasks or their usage charges.
class RetireJobListingReranking < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      UPDATE ai_tasks
      SET status = 'failed', result = NULL, message_history = '[]'::jsonb,
          pending_questions = '[]'::jsonb, awaiting_queue_publish = false,
          error_message = 'Job reranking is no longer available.',
          completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE task_type = 'rerank_job_listings'
        AND status IN ('queued', 'needs_user_input')
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, 'Retired work must not restart.'
  end
end
