# Keep import identity separate from editable application fields.
class LinkJobsToJobBoardListings < ActiveRecord::Migration[8.1]
  def change
    add_reference :jobs, :job_board_listing, type: :uuid, foreign_key: { on_delete: :nullify }
    add_index :jobs, [ :user_id, :job_board_listing_id ], unique: true
  end
end
