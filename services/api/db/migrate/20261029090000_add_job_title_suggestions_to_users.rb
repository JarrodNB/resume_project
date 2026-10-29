# Stores derived search ideas separately from the user's career facts.
class AddJobTitleSuggestionsToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :job_title_suggestions, :jsonb, null: false, default: []
  end
end
