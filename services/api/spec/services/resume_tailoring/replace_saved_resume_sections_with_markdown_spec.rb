# The destructive migration removes only old saved resumes and section snapshots.
require "rails_helper"
require Rails.root.join("db/migrate/20261023100000_replace_saved_resume_sections_with_markdown")

RSpec.describe ReplaceSavedResumeSectionsWithMarkdown do
  it "deletes legacy resumes while leaving neighboring job, library, and task records" do
    connection = ActiveRecord::Base.connection
    schema = "legacy_resume_migration_#{SecureRandom.hex(4)}"
    original_path = connection.schema_search_path
    connection.execute("CREATE SCHEMA #{schema}")
    connection.schema_search_path = schema
    connection.execute("CREATE TABLE resumes (id integer PRIMARY KEY)")
    connection.execute("CREATE TABLE resume_sections (id integer PRIMARY KEY, resume_id integer)")
    %w[jobs library_facts ai_tasks].each { |table| connection.execute("CREATE TABLE #{table} (id integer PRIMARY KEY)") }
    connection.execute("INSERT INTO resumes VALUES (1)")
    connection.execute("INSERT INTO resume_sections VALUES (1, 1)")
    %w[jobs library_facts ai_tasks].each { |table| connection.execute("INSERT INTO #{table} VALUES (1)") }

    described_class.new.migrate(:up)

    expect(connection.select_value("SELECT count(*) FROM resumes").to_i).to eq(0)
    expect(connection.data_source_exists?("resume_sections")).to be(false)
    expect(connection.columns("resumes").map(&:name)).to include("markdown", "target_pages")
    %w[jobs library_facts ai_tasks].each { |table| expect(connection.select_value("SELECT count(*) FROM #{table}").to_i).to eq(1) }
  ensure
    connection.schema_search_path = original_path if connection && original_path
    connection.execute("DROP SCHEMA IF EXISTS #{schema} CASCADE") if connection && schema
  end
end
