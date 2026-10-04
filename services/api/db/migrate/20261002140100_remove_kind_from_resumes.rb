# Description: Resumes are always tailored to a job now (the career library is the base), so base
# resumes are deleted and the kind column is dropped.
class RemoveKindFromResumes < ActiveRecord::Migration[8.1]
  def up
    execute "DELETE FROM resume_sections WHERE resume_id IN (SELECT id FROM resumes WHERE kind = 'base')"
    execute "DELETE FROM resumes WHERE kind = 'base'"
    remove_column :resumes, :kind
  end

  def down
    add_column :resumes, :kind, :string, null: false, default: "tailored"
  end
end
