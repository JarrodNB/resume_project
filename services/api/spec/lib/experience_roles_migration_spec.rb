# Runs the real expansion/backfill in an isolated schema to preserve the application tables.
require "rails_helper"
require Rails.root.join("db/migrate/20261023010000_create_experience_roles")

RSpec.describe CreateExperienceRoles do
  let(:connection) { ActiveRecord::Base.connection }

  around do |example|
    original_path = connection.schema_search_path
    schema = "migration_roles_#{SecureRandom.hex(6)}"
    connection.execute("CREATE SCHEMA #{schema}")
    connection.schema_search_path = schema
    connection.create_table(:experiences, id: :uuid) do |t|
      t.string :company
      t.string :title
      t.date :start_date
      t.date :end_date
      t.text :description
      t.timestamps
    end
    connection.create_table(:experience_highlights, id: :uuid) do |t|
      t.uuid :experience_id, null: false
      t.text :content
      t.integer :position
      t.timestamps
    end
    example.run
  ensure
    connection.schema_search_path = original_path
    connection.execute("DROP SCHEMA IF EXISTS #{schema} CASCADE") if schema
    connection.schema_cache.clear!
  end

  def seed_and_migrate
    connection.execute(<<~SQL)
      INSERT INTO experiences (id, company, title, start_date, end_date, description, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-000000000001', 'Same company', 'Engineer', '2020-01-01', '2021-12-01', 'Entry description', NOW(), NOW()),
             ('00000000-0000-0000-0000-000000000002', 'Same company', 'Lead', '2022-01-01', NULL, NULL, NOW(), NOW());
      INSERT INTO experience_highlights (id, experience_id, content, position, created_at, updated_at)
      VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Original bullet', 4, NOW(), NOW());
    SQL
    @entries_before = connection.select_all("SELECT * FROM experiences ORDER BY id").to_a
    @highlights_before = connection.select_all("SELECT * FROM experience_highlights ORDER BY id").to_a
    described_class.new.migrate(:up)
    connection.execute("SET CONSTRAINTS ALL IMMEDIATE")
  end

  it "backfills one role per old entry without combining companies or rewriting stable content" do
    seed_and_migrate
    expect(connection.select_all("SELECT * FROM experiences ORDER BY id").to_a).to eq(@entries_before)
    highlights = connection.select_all("SELECT * FROM experience_highlights ORDER BY id").to_a
    expect(highlights.map { |row| row.except("experience_role_id") }).to eq(@highlights_before)
    roles = connection.select_all("SELECT * FROM experience_roles ORDER BY experience_id").to_a
    expect(roles.map { |row| row.slice("experience_id", "title", "start_date", "end_date", "position", "description") }).to eq(
      @entries_before.map do |entry|
        entry.slice("title", "start_date", "end_date").merge("experience_id" => entry["id"], "position" => 0, "description" => nil)
      end
    )
    expect(highlights.first["experience_role_id"]).to eq(roles.first["id"])
    described_class.new.migrate(:down)
    expect(connection.select_all("SELECT * FROM experiences ORDER BY id").to_a).to eq(@entries_before)
    expect(connection.select_all("SELECT * FROM experience_highlights ORDER BY id").to_a).to eq(@highlights_before)
  end

  it "refuses a lossy downgrade after grouped roles are introduced" do
    seed_and_migrate
    connection.execute("INSERT INTO experience_roles (experience_id, title, position, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000001', 'Another title', 1, NOW(), NOW())")
    expect { described_class.new.migrate(:down) }.to raise_error(ActiveRecord::IrreversibleMigration, /reconcile grouped data/)
    expect(connection.select_value("SELECT count(*) FROM experience_roles")).to eq(3)
  end

  it "refuses a lossy downgrade for new shared bullets, role descriptions or divergent dates" do
    seed_and_migrate
    [
      "UPDATE experience_highlights SET experience_role_id = NULL",
      "UPDATE experience_roles SET description = 'Role-specific context'",
      "UPDATE experience_roles SET start_date = '2019-01-01'"
    ].each do |change|
      connection.transaction(requires_new: true) do
        connection.execute(change)
        expect { described_class.new.migrate(:down) }.to raise_error(ActiveRecord::IrreversibleMigration)
        raise ActiveRecord::Rollback
      end
    end
  end
end
