# Keep summary text separate from whether it appears in resume output.
# Existing users and resumes retain their current summary inclusion behavior.
class AddSummaryInclusionPreferences < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :include_summary, :boolean, null: false, default: true
    add_column :resumes, :include_summary, :boolean, null: false, default: true
  end
end
