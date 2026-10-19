# Server-side browser sessions are revocable without trusting the browser's cookie lifetime.
class CreateSessions < ActiveRecord::Migration[8.1]
  def change
    create_table :sessions, id: :uuid do |table|
      table.string :session_id, null: false
      table.text :data
      table.timestamps null: false
    end
    add_index :sessions, :session_id, unique: true
    add_index :sessions, :updated_at
  end
end
