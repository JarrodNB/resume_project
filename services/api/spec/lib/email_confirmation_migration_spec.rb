# Runs the actual migration against a temporary users table, preserving the real application table.
require "rails_helper"
require Rails.root.join("db/migrate/20261020020000_add_email_confirmation_to_users")

RSpec.describe AddEmailConfirmationToUsers do
  it "confirms only existing rows without changing identity, hashes or profile data" do
    connection = ActiveRecord::Base.connection
    connection.execute("CREATE TEMP TABLE users (id text PRIMARY KEY, encrypted_password text, name text)")
    connection.execute("INSERT INTO users VALUES ('legacy', 'existing-hash', 'Ada')")
    described_class.new.migrate(:up)
    old = connection.select_one("SELECT * FROM users WHERE id = 'legacy'")
    expect(old.slice("id", "encrypted_password", "name")).to eq("id" => "legacy", "encrypted_password" => "existing-hash", "name" => "Ada")
    expect(old["confirmed_at"]).to be_present
    connection.execute("INSERT INTO users (id, encrypted_password) VALUES ('new', 'new-hash')")
    expect(connection.select_value("SELECT confirmed_at FROM users WHERE id = 'new'")).to be_nil
  ensure
    connection&.execute("DROP TABLE IF EXISTS pg_temp.users")
    connection&.schema_cache&.clear!
  end
end
