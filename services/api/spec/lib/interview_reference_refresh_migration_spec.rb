# Verify legacy retry exhaustion survives the refresh migration in an isolated schema.
require "rails_helper"
require Rails.root.join("db/migrate/20261031020000_allow_interview_reference_refreshes")

RSpec.describe AllowInterviewReferenceRefreshes do
  it "backfills cycle retries, permits later generations, and cascades visit receipts" do
    connection = ActiveRecord::Base.connection
    original_path = connection.schema_search_path
    schema = "reference_refresh_#{SecureRandom.hex(6)}"
    connection.transaction(requires_new: true) do
      connection.execute("CREATE SCHEMA #{connection.quote_table_name(schema)}")
      connection.schema_search_path = schema
      connection.create_table(:interview_career_references, id: :uuid) do |t|
        t.integer :attempt_count, null: false, default: 0
        t.jsonb :references, null: false, default: []
      end
      connection.add_check_constraint :interview_career_references,
        "attempt_count BETWEEN 0 AND 2", name: "interview_career_reference_bounds"
      ids = 3.times.map do |count|
        id = SecureRandom.uuid
        connection.execute("INSERT INTO interview_career_references (id, attempt_count) VALUES ('#{id}', #{count})")
        id
      end
      described_class.new.migrate(:up)
      expect(connection.select_values("SELECT retry_count FROM interview_career_references ORDER BY attempt_count")).to eq([0, 0, 1])
      connection.execute("UPDATE interview_career_references SET attempt_count=3 WHERE id='#{ids.last}'")
      connection.execute("INSERT INTO interview_reference_visits (id, career_references_id, visit_id) VALUES (gen_random_uuid(), '#{ids.last}', gen_random_uuid())")
      connection.execute("DELETE FROM interview_career_references WHERE id='#{ids.last}'")
      expect(connection.select_value("SELECT COUNT(*) FROM interview_reference_visits")).to eq(0)
      raise ActiveRecord::Rollback
    end
  ensure
    connection.schema_search_path = original_path if connection && original_path
    connection&.schema_cache&.clear!
  end
end
