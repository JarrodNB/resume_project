# Description: Creates experience highlights (career library): ordered bullet points for an experience.
class CreateExperienceHighlights < ActiveRecord::Migration[8.1]
  def change
    create_table :experience_highlights, id: :uuid do |t|
      t.references :experience, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.text :content, null: false
      t.integer :position, null: false, default: 0

      t.timestamps
    end
  end
end
