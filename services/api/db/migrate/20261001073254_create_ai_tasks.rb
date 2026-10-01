# Description: Creates AI tasks: one row per unit of AI work sent to the worker over SQS,
# tracking its status, result, and (for human-in-the-loop) message history and pending questions.
class CreateAiTasks < ActiveRecord::Migration[8.1]
  def change
    create_table :ai_tasks, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.references :subject, polymorphic: true, null: true, type: :uuid
      t.string :task_type, null: false
      t.string :status, null: false, default: "queued"
      t.jsonb :input, null: false, default: {}
      t.jsonb :result
      t.jsonb :message_history, null: false, default: []
      t.jsonb :pending_questions, null: false, default: []
      t.text :error_message
      t.datetime :completed_at

      t.timestamps
    end
    add_index :ai_tasks, [ :user_id, :status ]
  end
end
