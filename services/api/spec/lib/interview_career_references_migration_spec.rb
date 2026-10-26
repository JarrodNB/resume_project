# Exercises actual up/down DDL in a rolled-back isolated schema, never application tables.
require "rails_helper"
require Rails.root.join("db/migrate/20261027010000_create_interview_career_references")

RSpec.describe CreateInterviewCareerReferences do
  it "rolls back an unused feature and restores the previous interview-child constraint" do
    connection = ActiveRecord::Base.connection
    original_path = connection.schema_search_path
    schema = "reference_migration_#{SecureRandom.hex(6)}"
    connection.transaction(requires_new: true) do
      connection.execute("CREATE SCHEMA #{connection.quote_table_name(schema)}")
      connection.schema_search_path = schema
      connection.create_table(:interview_sessions, id: :uuid)
      connection.create_table(:interview_session_messages, id: :uuid) { |t| t.uuid :interview_session_id }
      connection.create_table(:ai_tasks, id: :uuid) do |t|
        t.uuid :hourly_admission_task_id
        t.string :task_type
        t.string :subject_type
        t.uuid :subject_id
      end
      previous = "hourly_admission_task_id IS NULL OR (hourly_admission_task_id <> id AND task_type IN ('interview_turn', 'interview_speech', 'interview_transcription', 'interview_clarification') AND subject_type = 'InterviewSession' AND subject_id IS NOT NULL)"
      connection.add_check_constraint :ai_tasks, previous, name: "ai_task_hourly_interview_child"
      described_class.new.migrate(:up)
      expect(connection.table_exists?(:interview_career_references)).to be(true)
      described_class.new.migrate(:down)
      expect(connection.table_exists?(:interview_career_references)).to be(false)
      constraint = connection.check_constraints(:ai_tasks).find { |check| check.name == "ai_task_hourly_interview_child" }
      expect(constraint.expression).to include("interview_clarification")
      expect(constraint.expression).not_to include("interview_references")
      connection.execute("INSERT INTO ai_tasks (id, hourly_admission_task_id, task_type, subject_type, subject_id) VALUES (gen_random_uuid(), gen_random_uuid(), 'interview_clarification', 'InterviewSession', gen_random_uuid())")
      expect do
        connection.transaction(requires_new: true) do
          connection.execute("INSERT INTO ai_tasks (id, hourly_admission_task_id, task_type, subject_type, subject_id) VALUES (gen_random_uuid(), gen_random_uuid(), 'interview_references', 'InterviewSession', gen_random_uuid())")
        end
      end.to raise_error(ActiveRecord::StatementInvalid, /ai_task_hourly_interview_child/)
      raise ActiveRecord::Rollback
    end
  ensure
    connection.schema_search_path = original_path if connection && original_path
    connection&.schema_cache&.clear!
  end
end
