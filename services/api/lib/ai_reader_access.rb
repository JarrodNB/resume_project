# Description: The read-only database access of the AI worker's `ai_reader` role. Only the tables
# and columns listed here are readable; adding a table to the worker's reach is a deliberate edit.
# Grants live here (applied by `bin/rails db:grant_ai_reader_access`, which runs after db:prepare,
# db:migrate, and db:schema:load) because schema.rb doesn't record them.
# Index:
#   - ROLE_NAME / READABLE_*: the exact tables and columns the worker may read
#   - role_exists?: whether the role exists in this Postgres cluster
#   - grant: revokes every other privilege and grants exactly the allowed ones
require_relative "ai_study_guide_reader_views"

module AiReaderAccess
  ROLE_NAME = "ai_reader".freeze
  READABLE_TABLES = %w[
    jobs experiences experience_highlights projects educations certifications skills career_contexts library_embeddings
  ].freeze
  READABLE_USER_COLUMNS = %w[id summary name contact_email phone location links screened_fields].freeze

  READABLE_TASK_COLUMNS = %w[id user_id task_type status input subject_id subject_type].freeze

  READABLE_PRACTICE_COLUMNS = {
    "interview_question_sets" => %w[id user_id number set_type created_at],
    "interview_questions" => %w[id interview_question_set_id position question_text question_revision answer_revision retired_at answer_text screened_fields],
    "avoided_interview_questions" => %w[id user_id question_text created_at]
  }.freeze

  READABLE_RESUME_COLUMNS = %w[id user_id].freeze
  READABLE_SECTION_COLUMNS = %w[id resume_id section_type content position].freeze
  READABLE_EXECUTION_COLUMNS = {
    interview_sessions: %w[id user_id job_id status execution_mode revision current_question_position expires_at content_purged_at career_focus preparation_kind prepared_role fixture_context setup_config],
    interview_session_operations: %w[id interview_session_id question_id message_id recording_id kind status attempt_id claim_generation lease_expires_at execution_deadline expected_revision candidate_transcript transcription_mode],
    interview_session_questions: %w[id interview_session_id content position skipped_at],
    interview_session_messages: %w[id interview_session_id question_id kind content acknowledgement position],
    chat_conversations: %w[id user_id summary_text summary_version summary_through_position],
    chat_operations: %w[id chat_conversation_id message status attempt_id claim_generation lease_expires_at execution_deadline expected_position summary_base_version summary_plan],
    chat_messages: %w[chat_conversation_id position role content screened_sha256],
    avoided_interview_questions: %w[user_id question_text created_at id]
  }.freeze

  module_function

  # Whether the ai_reader role exists (roles are created outside Rails: init SQL, Terraform).
  def role_exists?(connection)
    connection.select_value("SELECT 1 FROM pg_roles WHERE rolname = #{connection.quote(ROLE_NAME)}").present?
  end

  # Resets ai_reader to the allowed tables and explicit user/task columns.
  def grant(connection)
    role = connection.quote_column_name(ROLE_NAME)
    tables = READABLE_TABLES.map { |table| connection.quote_table_name(table) }.join(", ")
    user_columns = READABLE_USER_COLUMNS.map { |column| connection.quote_column_name(column) }.join(", ")

    connection.transaction do
      AiStudyGuideReaderViews.create(connection)
      connection.execute("ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM #{role}")
      connection.execute("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM #{role}")
      connection.execute(<<~SQL)
        CREATE OR REPLACE VIEW ai_accepted_resume_prose AS
        SELECT accepted.user_id, prose.value AS prose FROM ai_tasks accepted
        CROSS JOIN LATERAL jsonb_array_elements_text(
          jsonb_path_query_array(accepted.result, '$.sections[*] ? (@.section_type == "experience").content.items[*].highlights[*]') ||
          jsonb_path_query_array(accepted.result, '$.sections[*] ? (@.section_type == "projects").content.items[*].description')
        ) AS prose(value)
        WHERE accepted.task_type = 'tailor_resume' AND accepted.status = 'completed' AND accepted.accepted_at IS NOT NULL
      SQL
      connection.execute("GRANT SELECT (user_id, prose) ON ai_accepted_resume_prose TO #{role}")
      connection.execute("GRANT SELECT (#{READABLE_RESUME_COLUMNS.join(', ')}) ON resumes TO #{role}")
      connection.execute("GRANT SELECT (#{READABLE_SECTION_COLUMNS.join(', ')}) ON resume_sections TO #{role}")
      connection.execute("GRANT USAGE ON SCHEMA public TO #{role}")
      connection.execute("GRANT SELECT ON ai_study_guide_commands, ai_study_guide_questions TO #{role}")
      connection.execute(<<~SQL)
        CREATE OR REPLACE VIEW ai_generated_preference_criteria WITH (security_barrier = true) AS
        SELECT DISTINCT tasks.user_id, criterion.value->>'text' AS text
        FROM ai_tasks tasks CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(tasks.result->'criteria') = 'array'
            THEN tasks.result->'criteria' ELSE '[]'::jsonb END) criterion(value)
        WHERE tasks.task_type = 'elicit_job_preferences' AND tasks.status = 'completed'
          AND jsonb_typeof(criterion.value->'text') = 'string'
      SQL
      connection.execute("GRANT SELECT ON ai_generated_preference_criteria TO #{role}")
      connection.execute("GRANT SELECT ON #{tables} TO #{role}")
      connection.execute("GRANT SELECT (#{user_columns}) ON users TO #{role}")
      connection.execute("GRANT SELECT (id, payload, screened_sha256) ON job_board_listings TO #{role}")
      connection.execute("GRANT SELECT (id, user_id, confirmed_revision, confirmed_criteria, screened_criteria_sha256) ON job_preference_profiles TO #{role}")
      task_columns = READABLE_TASK_COLUMNS.map { |column| connection.quote_column_name(column) }.join(", ")
      connection.execute("GRANT SELECT (#{task_columns}) ON ai_tasks TO #{role}")
      # A nonmaterialized projection keeps other task outputs/history private.
      connection.execute(<<~SQL)
        CREATE OR REPLACE VIEW completed_gap_analysis_sources AS
        SELECT id, user_id, subject_id AS job_id, result->'gap_analysis' AS gap_analysis
        FROM ai_tasks WHERE task_type = 'analyze_gaps' AND status = 'completed'
          AND subject_type = 'Job'
      SQL
      connection.execute("GRANT SELECT ON completed_gap_analysis_sources TO #{role}")
      connection.execute(<<~SQL)
        CREATE OR REPLACE VIEW queued_tailoring_commands AS
        SELECT id, user_id, subject_id AS job_id FROM ai_tasks
        WHERE task_type = 'tailor_resume' AND status = 'queued' AND subject_type = 'Job'
      SQL
      connection.execute("GRANT SELECT ON queued_tailoring_commands TO #{role}")
      connection.execute("GRANT SELECT (id, job_id, requirement, body, screened_fields, created_at) ON job_gap_responses TO #{role}")
      READABLE_EXECUTION_COLUMNS.each do |table, columns|
        selected = columns.map { |column| connection.quote_column_name(column) }.join(", ")
        connection.execute("GRANT SELECT (#{selected}) ON #{connection.quote_table_name(table)} TO #{role}")
      end
      # Only these workflows expose generated outputs/history. Account, provider and
      # other task results remain outside the worker's role.
      connection.execute(<<~SQL)
        CREATE OR REPLACE VIEW ai_library_exchanges WITH (security_barrier = true) AS
        SELECT id, user_id, task_type, status, input, result, message_history, pending_questions, accepted_at
        FROM ai_tasks WHERE task_type IN ('improve_library_entry', 'review_library_section')
      SQL
      connection.execute("GRANT SELECT ON ai_library_exchanges TO #{role}")
      READABLE_PRACTICE_COLUMNS.each do |table, columns|
        selected = columns.map { |column| connection.quote_column_name(column) }.join(", ")
        connection.execute("GRANT SELECT (#{selected}) ON #{connection.quote_table_name(table)} TO #{role}")
      end
    end
  end
end
