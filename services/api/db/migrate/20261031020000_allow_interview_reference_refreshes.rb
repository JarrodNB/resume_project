# Keep refresh generations ordered while bounding retries within each search cycle.
# Visit receipts survive duplicate navigation requests and disappear with their references.
class AllowInterviewReferenceRefreshes < ActiveRecord::Migration[8.1]
  def up
    add_column :interview_career_references, :retry_count, :integer, null: false, default: 0
    execute 'UPDATE interview_career_references SET retry_count = GREATEST(attempt_count - 1, 0)'
    remove_check_constraint :interview_career_references, name: 'interview_career_reference_bounds'
    add_check_constraint :interview_career_references, "attempt_count >= 0 AND retry_count BETWEEN 0 AND 1 AND jsonb_typeof(\"references\") = 'array' AND jsonb_array_length(\"references\") <= 3", name: 'interview_career_reference_bounds'
    create_table :interview_reference_visits, id: :uuid do |t|
      t.references :career_references, type: :uuid, null: false, foreign_key: { to_table: :interview_career_references, on_delete: :cascade }
      t.uuid :visit_id, null: false
      t.index [:career_references_id, :visit_id], unique: true, name: 'interview_reference_visit_identity'
    end
  end

  def down
    raise ActiveRecord::IrreversibleMigration, 'Refresh history can exceed the original two-attempt constraint'
  end
end
