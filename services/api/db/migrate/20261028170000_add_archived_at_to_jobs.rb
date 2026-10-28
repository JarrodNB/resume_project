# Keeps archived jobs and all their related data while hiding them from active lists.
class AddArchivedAtToJobs < ActiveRecord::Migration[8.1]
  def change
    add_column :jobs, :archived_at, :datetime
  end
end
