# Description: Creates projects (career library): personal, open source, or work projects.
class CreateProjects < ActiveRecord::Migration[8.1]
  def change
    create_table :projects, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.string :name, null: false
      t.string :role
      t.string :url
      t.text :description
      t.date :start_date
      t.date :end_date
      t.integer :position, null: false, default: 0

      t.timestamps
    end
  end
end
