# Description: Creates jobs: structured job profiles the user tracks through application stages.
class CreateJobs < ActiveRecord::Migration[8.1]
  def change
    create_table :jobs, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.string :title, null: false
      t.string :company, null: false
      t.string :location
      t.string :url
      t.text :description
      t.jsonb :requirements, null: false, default: []
      t.jsonb :nice_to_haves, null: false, default: []
      t.string :stage, null: false, default: "unapplied"
      t.datetime :applied_at
      t.text :notes

      t.timestamps
    end
    add_index :jobs, [ :user_id, :stage ]
  end
end
