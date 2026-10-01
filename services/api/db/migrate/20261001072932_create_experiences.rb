# Description: Creates experiences (career library): jobs/roles the user has held.
class CreateExperiences < ActiveRecord::Migration[8.1]
  def change
    create_table :experiences, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.string :company, null: false
      t.string :title, null: false
      t.string :location
      t.date :start_date
      t.date :end_date
      t.text :description
      t.integer :position, null: false, default: 0

      t.timestamps
    end
  end
end
