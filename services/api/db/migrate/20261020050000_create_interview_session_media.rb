# Tracks private staged and sealed media independently of public Active Storage routes.
# Keys are reserved durably before object I/O so interrupted uploads remain collectible.
class CreateInterviewSessionMedia < ActiveRecord::Migration[8.1]
  def change
    add_column :interview_sessions, :content_purged_at, :datetime
    create_table :interview_session_media, id: :uuid do |t|
      t.references :interview_session, null: false, type: :uuid, foreign_key: true
      t.references :question, null: false, type: :uuid, foreign_key: { to_table: :interview_session_questions }
      t.references :operation, type: :uuid, foreign_key: { to_table: :interview_session_operations }
      t.references :message, type: :uuid, foreign_key: { to_table: :interview_session_messages }
      t.string :kind, null: false
      t.string :status, null: false, default: "reserved"
      t.string :staging_key
      t.string :sealed_key
      t.string :content_type, null: false
      t.bigint :byte_size
      t.string :checksum
      t.uuid :attempt_id
      t.integer :claim_generation
      t.datetime :expires_at, null: false
      t.datetime :deleted_at
      t.integer :deletion_attempts, null: false, default: 0
      t.datetime :next_delete_at
      t.string :last_delete_error
      t.jsonb :metadata, null: false, default: {}
      t.timestamps
    end
    add_index :interview_session_media, :staging_key, unique: true
    add_index :interview_session_media, :sealed_key, unique: true
    add_index :interview_session_media, [ :operation_id, :attempt_id ], unique: true, where: "kind = 'speech'"
    add_index :interview_session_media, :expires_at
    add_index :interview_session_operations, [ :interview_session_id, :question_id, :id ], unique: true, name: "interview_operation_media_identity"
    add_foreign_key :interview_session_media, :interview_session_questions,
      column: [ :interview_session_id, :question_id ], primary_key: [ :interview_session_id, :id ], name: "interview_media_owned_question"
    add_foreign_key :interview_session_media, :interview_session_messages,
      column: [ :interview_session_id, :question_id, :message_id ], primary_key: [ :interview_session_id, :question_id, :id ], name: "interview_media_owned_message"
    add_foreign_key :interview_session_media, :interview_session_operations,
      column: [ :interview_session_id, :question_id, :operation_id ], primary_key: [ :interview_session_id, :question_id, :id ], name: "interview_media_owned_operation"
    add_check_constraint :interview_session_media, "kind IN ('recording', 'speech')", name: "interview_media_kind"
    add_check_constraint :interview_session_media, "status IN ('reserved', 'ready', 'delete_pending', 'deleted')", name: "interview_media_status"
    add_check_constraint :interview_session_media, "byte_size IS NULL OR byte_size > 0", name: "interview_media_bytes"
    add_check_constraint :interview_session_media, "deletion_attempts >= 0", name: "interview_media_deletions"
    add_check_constraint :interview_session_media, "(kind = 'recording' AND question_id IS NOT NULL) OR (kind = 'speech' AND operation_id IS NOT NULL AND message_id IS NOT NULL AND attempt_id IS NOT NULL AND claim_generation IS NOT NULL)", name: "interview_media_identity"
  end
end
