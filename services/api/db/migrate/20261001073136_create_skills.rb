# Description: Creates skills (career library), optionally grouped by category.
class CreateSkills < ActiveRecord::Migration[8.1]
  def change
    create_table :skills, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.string :name, null: false
      t.string :category
      t.integer :position, null: false, default: 0

      t.timestamps
    end
    add_index :skills, [ :user_id, :name ], unique: true
  end
end
