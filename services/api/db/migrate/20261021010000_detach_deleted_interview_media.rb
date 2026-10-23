# Keeps random object keys collectible after the owning interview is removed.
# Detached rows may contain only deletion bookkeeping, never dialogue or ownership.
class DetachDeletedInterviewMedia < ActiveRecord::Migration[8.1]
  def up
    change_column_null :interview_session_media, :interview_session_id, true
    change_column_null :interview_session_media, :question_id, true
    remove_check_constraint :interview_session_media, name: "interview_media_identity"
    add_check_constraint :interview_session_media, <<~SQL.squish, name: "interview_media_identity"
      (interview_session_id IS NOT NULL AND question_id IS NOT NULL AND
        ((kind = 'recording') OR (kind = 'speech' AND operation_id IS NOT NULL AND message_id IS NOT NULL AND attempt_id IS NOT NULL AND claim_generation IS NOT NULL)))
      OR (interview_session_id IS NULL AND question_id IS NULL AND operation_id IS NULL AND message_id IS NULL
        AND attempt_id IS NULL AND claim_generation IS NULL AND status IN ('delete_pending', 'deleted')
        AND metadata = '{}'::jsonb AND checksum IS NULL AND byte_size IS NULL
        AND (staging_key IS NOT NULL OR sealed_key IS NOT NULL))
    SQL
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Detached deletion receipts must survive until storage cleanup"
  end
end
