# Description: Gap responses saved on a job, and the career-library facts created when the user
# chooses to keep one. A response stays on the job; only a library fact is embedded.
class CreateGapResponses < ActiveRecord::Migration[8.1]
  def change
    create_table :library_facts, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.text :requirement, null: false
      t.text :response, null: false

      t.timestamps
    end
    add_index :library_facts, [ :user_id, :requirement ], unique: true

    create_table :job_gap_responses, id: :uuid do |t|
      t.references :job, null: false, foreign_key: true, type: :uuid
      t.text :requirement, null: false
      t.text :body, null: false
      t.references :library_fact, foreign_key: { on_delete: :nullify }, type: :uuid

      t.timestamps
    end
    add_index :job_gap_responses, [ :job_id, :requirement ], unique: true
  end
end
