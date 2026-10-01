# Description: Creates resumes: documents built from the career library. A base resume has no
# job; a tailored resume belongs to the job it was written for.
class CreateResumes < ActiveRecord::Migration[8.1]
  def change
    create_table :resumes, id: :uuid do |t|
      t.references :user, null: false, foreign_key: true, type: :uuid
      t.references :job, null: true, foreign_key: { on_delete: :nullify }, type: :uuid
      t.string :title, null: false
      t.string :kind, null: false, default: "base"

      t.timestamps
    end
  end
end
