# Retains the preferred resume length without changing existing content.
# Existing saved resumes use the two-page default.
class AddTargetPageCountToResumes < ActiveRecord::Migration[8.1]
  def change
    add_column :resumes, :target_page_count, :integer, null: false, default: 2
    add_check_constraint :resumes, "target_page_count IN (1, 2)", name: "resumes_target_page_count_allowed"
  end
end
