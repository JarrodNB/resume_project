# Remove next-job preference data and retire pending work while preserving AI usage history.
class RemoveJobSearchPreferences < ActiveRecord::Migration[8.1]
  def up
    execute "DROP VIEW IF EXISTS ai_generated_preference_criteria"
    drop_table :job_preference_profiles
    remove_column :job_board_listings, :screened_sha256
    execute <<~SQL
      UPDATE ai_tasks
      SET status = 'failed', result = NULL, message_history = '[]'::jsonb,
          pending_questions = '[]'::jsonb, awaiting_queue_publish = false,
          error_message = 'Job preferences are no longer available.',
          completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE task_type IN ('elicit_job_preferences', 'check_job_preferences')
        AND status IN ('queued', 'needs_user_input')
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, 'Removed job preference data cannot be restored.'
  end
end
