# Keep immutable resume inputs separate from mutable task and category outcomes.
class CreateAtsCheckRuns < ActiveRecord::Migration[8.1]
  def change
    create_table :ats_check_runs, id: :uuid do |t|
      t.references :user, null: false, type: :uuid, foreign_key: true
      t.references :resume, null: false, type: :uuid, foreign_key: true
      t.references :ai_task, type: :uuid, foreign_key: { on_delete: :nullify }
      t.jsonb :content_snapshot, null: false, default: []
      t.jsonb :job_snapshot, null: false, default: {}
      t.string :content_fingerprint, null: false
      t.string :job_fingerprint, null: false
      t.string :rubric_version, null: false
      t.string :status, null: false, default: "pending"
      t.string :error_message
      t.jsonb :content_result, null: false, default: {}
      t.jsonb :pdf_result, null: false, default: {}
      t.timestamps
    end
    add_index :ats_check_runs, [ :resume_id, :created_at ]
  end
end
