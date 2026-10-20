# Stores spoken demo dialogue separately from written interview practice. Partial unique
# indexes protect the processing slot and semantic messages even if callers race.
class CreateBasicInterviews < ActiveRecord::Migration[8.1]
  def change
    create_table :basic_interviews, id: :uuid do |t|
      t.references :user, null: false, type: :uuid, foreign_key: true
      t.string :status, null: false, default: "active"
      t.integer :revision, null: false, default: 0
      t.integer :current_question_position, null: false, default: 0
      t.integer :answer_cap, null: false, default: 2
      t.jsonb :fixture_context, null: false, default: {}
      t.datetime :expires_at, null: false
      t.datetime :completed_at
      t.timestamps
    end
    add_check_constraint :basic_interviews, "revision >= 0 AND current_question_position >= 0 AND answer_cap BETWEEN 1 AND 2", name: "basic_interview_counters"
    add_check_constraint :basic_interviews, "status IN ('active', 'completed', 'expired')", name: "basic_interview_status"

    create_table :basic_interview_questions, id: :uuid do |t|
      t.references :basic_interview, null: false, type: :uuid, foreign_key: { on_delete: :cascade }
      t.integer :position, null: false
      t.text :content, null: false
      t.integer :accepted_answer_count, null: false, default: 0
      t.integer :history_version, null: false, default: 1
      t.jsonb :model_history, null: false, default: []
      t.timestamps
    end
    add_index :basic_interview_questions, [ :basic_interview_id, :position ], unique: true
    add_index :basic_interview_questions, [ :basic_interview_id, :id ], unique: true, name: "basic_question_owner_identity"
    add_check_constraint :basic_interview_questions, "position >= 0 AND accepted_answer_count BETWEEN 0 AND 2 AND history_version > 0", name: "basic_question_counters"
    add_check_constraint :basic_interview_questions, "jsonb_typeof(model_history) = 'array'", name: "basic_question_history_array"

    create_table :basic_interview_messages, id: :uuid do |t|
      t.references :basic_interview, null: false, type: :uuid, foreign_key: { on_delete: :cascade }
      t.references :question, null: false, type: :uuid, foreign_key: { to_table: :basic_interview_questions, on_delete: :cascade }
      t.integer :position, null: false
      t.string :kind, null: false
      t.string :semantic_key, null: false
      t.text :content, null: false
      t.timestamps
    end
    add_index :basic_interview_messages, [ :basic_interview_id, :position ], unique: true
    add_index :basic_interview_messages, [ :basic_interview_id, :question_id, :id ], unique: true, name: "basic_message_owner_identity"
    add_foreign_key :basic_interview_messages, :basic_interview_questions,
      column: [ :basic_interview_id, :question_id ], primary_key: [ :basic_interview_id, :id ],
      on_delete: :cascade, name: "basic_message_owned_question"
    add_index :basic_interview_messages, [ :basic_interview_id, :semantic_key ], unique: true
    add_index :basic_interview_messages, :question_id, unique: true, where: "kind = 'opening'", name: "basic_one_opening_per_question"
    add_check_constraint :basic_interview_messages, "position >= 0 AND kind IN ('opening', 'answer', 'follow_up', 'closing')", name: "basic_message_kind"

    create_table :basic_interview_operations, id: :uuid do |t|
      t.references :basic_interview, null: false, type: :uuid, foreign_key: { on_delete: :cascade }
      t.references :question, null: false, type: :uuid, foreign_key: { to_table: :basic_interview_questions, on_delete: :cascade }
      t.references :message, type: :uuid, foreign_key: { to_table: :basic_interview_messages, on_delete: :cascade }
      t.string :kind, null: false
      t.string :status, null: false, default: "pending"
      t.string :submission_key
      t.string :request_fingerprint
      # Internal correlation only; ticket 03 supplies the owned media record and authorization.
      t.uuid :recording_id
      t.integer :expected_revision
      t.integer :claim_generation, null: false, default: 0
      t.uuid :attempt_id
      t.datetime :lease_expires_at
      t.datetime :execution_deadline
      t.string :result_fingerprint
      t.jsonb :accepted_result, null: false, default: {}
      t.datetime :accepted_at
      t.timestamps
    end
    add_foreign_key :basic_interview_operations, :basic_interview_questions,
      column: [ :basic_interview_id, :question_id ], primary_key: [ :basic_interview_id, :id ],
      on_delete: :cascade, name: "basic_operation_owned_question"
    add_foreign_key :basic_interview_operations, :basic_interview_messages,
      column: [ :basic_interview_id, :question_id, :message_id ], primary_key: [ :basic_interview_id, :question_id, :id ],
      on_delete: :cascade, name: "basic_operation_owned_message"
    add_index :basic_interview_operations, [ :basic_interview_id, :submission_key ], unique: true, where: "kind = 'turn'", name: "basic_submission_identity"
    add_index :basic_interview_operations, :basic_interview_id, unique: true, where: "kind = 'turn' AND status IN ('pending', 'running')", name: "basic_one_active_turn"
    add_index :basic_interview_operations, :message_id, unique: true, where: "kind = 'speech'", name: "basic_one_speech_per_message"
    add_check_constraint :basic_interview_operations, "kind IN ('turn', 'speech') AND status IN ('pending', 'running', 'accepted', 'failed', 'expired') AND claim_generation >= 0", name: "basic_operation_states"
    add_check_constraint :basic_interview_operations, "(kind = 'turn' AND submission_key IS NOT NULL AND request_fingerprint IS NOT NULL AND recording_id IS NOT NULL AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL) OR (kind = 'speech' AND message_id IS NOT NULL AND submission_key IS NULL)", name: "basic_operation_inputs"
    add_check_constraint :basic_interview_operations, "status <> 'accepted' OR (accepted_at IS NOT NULL AND result_fingerprint IS NOT NULL)", name: "basic_operation_accepted_result"
    add_check_constraint :basic_interview_operations, "status <> 'running' OR (claim_generation > 0 AND attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL AND execution_deadline IS NOT NULL)", name: "basic_operation_claim"
  end
end
