# Replace old saved section snapshots with a single editable Markdown document.
# The user chose deletion over conversion; task, job, library, and usage rows remain.
class ReplaceSavedResumeSectionsWithMarkdown < ActiveRecord::Migration[8.1]
  def up
    execute "DELETE FROM resume_sections"
    execute "DELETE FROM resumes"
    drop_table :resume_sections
    add_column :resumes, :markdown, :text, null: false
    add_column :resumes, :target_pages, :integer, null: false
    add_check_constraint :resumes, "target_pages IN (1, 2)", name: "resumes_target_pages_valid"
  end

  def down
    raise ActiveRecord::IrreversibleMigration, "Deleted structured resumes cannot be restored"
  end
end
