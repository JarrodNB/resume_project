# Description: Creates resume sections: ordered sections of a resume with a JSON content snapshot,
# so edits to a resume never change the career library.
class CreateResumeSections < ActiveRecord::Migration[8.1]
  def change
    create_table :resume_sections, id: :uuid do |t|
      t.references :resume, null: false, foreign_key: { on_delete: :cascade }, type: :uuid
      t.string :section_type, null: false
      t.string :title, null: false
      t.integer :position, null: false, default: 0
      t.jsonb :content, null: false, default: {}

      t.timestamps
    end
  end
end
