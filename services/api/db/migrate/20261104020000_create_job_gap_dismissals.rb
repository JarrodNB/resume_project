# Remember which job requirements the user chose not to answer. Keyed by requirement text, like
# job_gap_responses, so a dismissal survives re-running the comparison.
class CreateJobGapDismissals < ActiveRecord::Migration[8.1]
  def change
    create_table :job_gap_dismissals, id: :uuid do |t|
      t.references :job, type: :uuid, null: false, foreign_key: true, index: false
      t.text :requirement, null: false
      t.timestamps
    end
    add_index :job_gap_dismissals, [ :job_id, :requirement ], unique: true
  end
end
