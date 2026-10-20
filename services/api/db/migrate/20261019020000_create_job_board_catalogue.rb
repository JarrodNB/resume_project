# Keep public provider snapshots and ordered search pages separate from private Jobs.
class CreateJobBoardCatalogue < ActiveRecord::Migration[8.1]
  def change
    create_table :job_board_listings, id: :uuid do |t|
      t.bigint :provider_id, null: false
      t.jsonb :payload, null: false, default: {}
      t.timestamps
    end
    add_index :job_board_listings, :provider_id, unique: true

    create_table :job_board_search_pages, id: :uuid do |t|
      t.string :query_digest, null: false
      t.string :keyword, null: false
      t.boolean :remote_only, null: false, default: false
      t.text :cursor
      t.uuid :listing_ids, array: true, null: false, default: []
      t.text :next_cursor
      t.datetime :retrieved_at, null: false
      t.timestamps
    end
    add_index :job_board_search_pages, :query_digest, unique: true
  end
end
