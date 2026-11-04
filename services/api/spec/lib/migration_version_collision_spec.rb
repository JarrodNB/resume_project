# Reissued migrations repair either meaning of the old shared version without losing data.
require "rails_helper"
require Rails.root.join("db/migrate/20261104020000_add_created_at_indexes_for_site_ai_spend")
require Rails.root.join("db/migrate/20261104030000_create_job_gap_dismissals")

RSpec.describe "Migration version collision recovery" do
  self.use_transactional_tests = false

  around do |example|
    connection = ActiveRecord::Base.connection
    schema = "migration_collision_#{SecureRandom.hex(6)}"
    original_path = connection.schema_search_path
    connection.create_schema(schema)
    connection.schema_search_path = schema
    connection.create_table(:jobs, id: :uuid)
    %i[ai_tasks ai_embedding_requests].each do |table|
      connection.create_table(table, id: :uuid) { |t| t.datetime :created_at }
    end
    example.run
  ensure
    connection.schema_search_path = original_path
    connection.drop_schema(schema, if_exists: true, force: :cascade)
    connection.schema_cache.clear!
  end

  [ :neither, :indexes, :dismissals, :both ].each do |previously_applied|
    it "preserves rows and installs both changes when #{previously_applied} already existed" do
      connection = ActiveRecord::Base.connection
      indexes = AddCreatedAtIndexesForSiteAiSpend.new
      dismissals = CreateJobGapDismissals.new
      ActiveRecord::Migration.suppress_messages do
        indexes.migrate(:up) if %i[indexes both].include?(previously_applied)
        if %i[dismissals both].include?(previously_applied)
          dismissals.migrate(:up)
          connection.execute("INSERT INTO jobs (id) VALUES ('00000000-0000-0000-0000-000000000001')")
          connection.execute("INSERT INTO job_gap_dismissals (id, job_id, requirement, created_at, updated_at) VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', 'Keep this dismissal', NOW(), NOW())")
        end
        2.times do
          indexes.migrate(:up)
          dismissals.migrate(:up)
        end
      end
      %i[ai_tasks ai_embedding_requests].each do |table|
        expect(connection.index_exists?(table, :created_at)).to be(true)
      end
      expect(connection.index_exists?(:job_gap_dismissals, %i[job_id requirement], unique: true)).to be(true)
      expect(connection.foreign_key_exists?(:job_gap_dismissals, :jobs)).to be(true)
      expected = %i[dismissals both].include?(previously_applied) ? [ "Keep this dismissal" ] : []
      expect(connection.select_values("SELECT requirement FROM job_gap_dismissals")).to eq(expected)
    end
  end
end
