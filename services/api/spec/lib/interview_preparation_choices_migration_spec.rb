# Runs the actual legacy backfill in an isolated schema; original questions/dialogue stay intact.
require "rails_helper"
require Rails.root.join("db/migrate/20261030110000_add_interview_preparation_choices")

RSpec.describe AddInterviewPreparationChoices do
  it "keeps saved-job identity after nullable deletion and erases legacy source copies" do
    connection = ActiveRecord::Base.connection
    original_path = connection.schema_search_path
    schema = "interview_choices_#{SecureRandom.hex(6)}"
    connection.transaction(requires_new: true) do
      connection.execute("CREATE SCHEMA #{connection.quote_table_name(schema)}")
      connection.schema_search_path = schema
      connection.create_table(:interview_sessions, id: :uuid) do |t|
        t.uuid :job_id
        t.jsonb :frozen_context, null: false, default: {}
        t.jsonb :prepared_role, null: false, default: {}
      end
      saved_id = SecureRandom.uuid
      fictional_id = SecureRandom.uuid
      saved = connection.quote(JSON.generate(job: { title: "Deleted private job" }, career_focus: "engineering"))
      fictional = connection.quote(JSON.generate(career_focus: "laboratory"))
      role = connection.quote(JSON.generate(title: "Generated fictional technician"))
      connection.execute("INSERT INTO interview_sessions (id, frozen_context, prepared_role) VALUES ('#{saved_id}', #{saved}, #{role}), ('#{fictional_id}', #{fictional}, #{role})")
      described_class.new.migrate(:up)
      rows = connection.select_all("SELECT id, career_focus, preparation_kind, prepared_role, frozen_context FROM interview_sessions").to_a.index_by { |r| r["id"] }
      expect(rows[saved_id]).to include("career_focus" => "engineering", "preparation_kind" => "saved_job", "prepared_role" => "{}", "frozen_context" => "{}")
      expect(rows[fictional_id]).to include("career_focus" => "laboratory", "preparation_kind" => "fictional_role", "frozen_context" => "{}")
      expect(JSON.parse(rows[fictional_id]["prepared_role"])).to eq("title" => "Generated fictional technician")
      raise ActiveRecord::Rollback
    end
  ensure
    connection.schema_search_path = original_path if connection && original_path
    connection&.schema_cache&.clear!
  end
end
