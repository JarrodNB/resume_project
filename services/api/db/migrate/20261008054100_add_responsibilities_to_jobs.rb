# Description: A job's responsibility bullets, copied from the posting the same way requirements are.
class AddResponsibilitiesToJobs < ActiveRecord::Migration[8.1]
  def change
    add_column :jobs, :responsibilities, :jsonb, null: false, default: []
  end
end
