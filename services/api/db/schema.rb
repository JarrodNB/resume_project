# This file is auto-generated from the current state of the database. Instead
# of editing this file, please use the migrations feature of Active Record to
# incrementally modify your database, and then regenerate this schema definition.
#
# This file is the source Rails uses to define your schema when running `bin/rails
# db:schema:load`. When creating a new database, `bin/rails db:schema:load` tends to
# be faster and is potentially less error prone than running all of your
# migrations from scratch. Old migrations may fail to apply correctly if those
# migrations use external dependencies or application code.
#
# It's strongly recommended that you check this file into your version control system.

ActiveRecord::Schema[8.1].define(version: 2026_10_28_140000) do
  # These are extensions that must be enabled in order to support this database
  enable_extension "pg_catalog.plpgsql"
  enable_extension "vector"

  create_table "active_storage_attachments", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "name", null: false
    t.string "record_type", null: false
    t.uuid "record_id", null: false
    t.uuid "blob_id", null: false
    t.datetime "created_at", null: false
    t.index ["blob_id"], name: "index_active_storage_attachments_on_blob_id"
    t.index ["record_type", "record_id", "name", "blob_id"], name: "index_active_storage_attachments_uniqueness", unique: true
  end

  create_table "active_storage_blobs", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "key", null: false
    t.string "filename", null: false
    t.string "content_type"
    t.text "metadata"
    t.string "service_name", null: false
    t.bigint "byte_size", null: false
    t.string "checksum"
    t.datetime "created_at", null: false
    t.index ["key"], name: "index_active_storage_blobs_on_key", unique: true
  end

  create_table "active_storage_variant_records", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "blob_id", null: false
    t.string "variation_digest", null: false
    t.index ["blob_id", "variation_digest"], name: "index_active_storage_variant_records_uniqueness", unique: true
  end

  create_table "ai_embedding_requests", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "model", null: false
    t.string "purpose", null: false
    t.bigint "input_tokens"
    t.bigint "cost_microdollars"
    t.boolean "incomplete", default: true, null: false
    t.boolean "finalized", default: false, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id", "created_at"], name: "index_ai_embedding_requests_on_user_id_and_created_at"
    t.index ["user_id"], name: "index_ai_embedding_requests_on_user_id"
    t.check_constraint "cost_microdollars IS NULL OR cost_microdollars >= 0", name: "embedding_cost_nonnegative"
    t.check_constraint "input_tokens IS NULL OR input_tokens >= 0", name: "embedding_tokens_nonnegative"
  end

  create_table "ai_execution_stream_grants", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "session_digest", null: false
    t.string "feature", null: false
    t.uuid "operation_id", null: false
    t.uuid "attempt_id", null: false
    t.integer "claim_generation", null: false
    t.string "token_digest", null: false
    t.datetime "expires_at", null: false
    t.datetime "redeemed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["expires_at"], name: "index_ai_execution_stream_grants_on_expires_at"
    t.index ["token_digest"], name: "index_ai_execution_stream_grants_on_token_digest", unique: true
    t.index ["user_id"], name: "index_ai_execution_stream_grants_on_user_id"
    t.check_constraint "claim_generation > 0", name: "ai_stream_grant_positive_generation"
  end

  create_table "ai_job_recoveries", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "active_job_id", null: false
    t.integer "recovery_count", default: 0, null: false
    t.string "last_error"
    t.datetime "exhausted_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["active_job_id"], name: "index_ai_job_recoveries_on_active_job_id", unique: true
    t.check_constraint "recovery_count >= 0", name: "ai_job_recoveries_nonnegative_count"
  end

  create_table "ai_task_outcomes", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.uuid "ai_task_id", null: false
    t.bigserial "sequence", null: false
    t.string "task_type", null: false
    t.string "status", null: false
    t.datetime "completed_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["ai_task_id"], name: "index_ai_task_outcomes_on_ai_task_id"
    t.index ["sequence"], name: "index_ai_task_outcomes_on_sequence", unique: true
    t.index ["user_id", "sequence"], name: "index_ai_task_outcomes_on_user_id_and_sequence", unique: true
    t.index ["user_id"], name: "index_ai_task_outcomes_on_user_id"
    t.check_constraint "status::text = ANY (ARRAY['completed'::character varying::text, 'failed'::character varying::text])", name: "ai_task_outcomes_terminal_status"
  end

  create_table "ai_tasks", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "subject_type"
    t.uuid "subject_id"
    t.string "task_type", null: false
    t.string "status", default: "queued", null: false
    t.jsonb "input", default: {}, null: false
    t.jsonb "result"
    t.jsonb "message_history", default: [], null: false
    t.jsonb "pending_questions", default: [], null: false
    t.text "error_message"
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.datetime "accepted_at"
    t.integer "input_tokens", default: 0, null: false
    t.integer "cached_input_tokens", default: 0, null: false
    t.integer "output_tokens", default: 0, null: false
    t.bigint "cost_microdollars", default: 0, null: false
    t.integer "generation", default: 0, null: false
    t.integer "usage_generation", default: -1, null: false
    t.uuid "hourly_admission_task_id"
    t.index ["hourly_admission_task_id"], name: "index_ai_tasks_on_hourly_admission_task_id"
    t.index ["subject_type", "subject_id"], name: "index_ai_tasks_on_subject"
    t.index ["user_id", "created_at"], name: "index_ai_tasks_on_user_id_and_created_at"
    t.index ["user_id", "status"], name: "index_ai_tasks_on_user_id_and_status"
    t.index ["user_id"], name: "index_ai_tasks_on_user_id"
    t.check_constraint "hourly_admission_task_id IS NULL OR hourly_admission_task_id <> id AND (task_type::text = ANY (ARRAY['interview_turn'::character varying::text, 'interview_speech'::character varying::text, 'interview_transcription'::character varying::text, 'interview_clarification'::character varying::text, 'interview_references'::character varying::text])) AND subject_type::text = 'InterviewSession'::text AND subject_id IS NOT NULL", name: "ai_task_hourly_interview_child"
  end

  create_table "ai_usage_attempts", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "ai_task_id", null: false
    t.uuid "attempt_id", null: false
    t.jsonb "usage", default: [], null: false
    t.boolean "incomplete", default: false, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.boolean "finalized", default: true, null: false
    t.index ["ai_task_id"], name: "index_ai_usage_attempts_on_ai_task_id"
    t.index ["attempt_id"], name: "index_ai_usage_attempts_on_attempt_id", unique: true
  end

  create_table "ai_usage_reconciliations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "receipt_reference", null: false
    t.uuid "attempt_id", null: false
    t.string "record_type", null: false
    t.jsonb "previous_usage", default: [], null: false
    t.jsonb "usage", default: [], null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["receipt_reference"], name: "index_ai_usage_reconciliations_on_receipt_reference", unique: true
    t.index ["record_type", "attempt_id"], name: "index_ai_usage_reconciliations_on_record_type_and_attempt_id", unique: true
  end

  create_table "avoided_interview_questions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.text "question_text", null: false
    t.string "text_digest", limit: 64, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id", "text_digest"], name: "index_avoided_interview_questions_on_user_id_and_text_digest", unique: true
    t.index ["user_id"], name: "index_avoided_interview_questions_on_user_id"
    t.check_constraint "char_length(question_text) >= 1 AND char_length(question_text) <= 2000", name: "avoided_question_text_length"
  end

  create_table "certifications", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "name", null: false
    t.string "issuer"
    t.date "issued_date"
    t.date "expiry_date"
    t.string "credential_id"
    t.string "credential_url"
    t.text "description"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "issued_date_precision", default: "day", null: false
    t.string "expiry_date_precision", default: "day", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["user_id"], name: "index_certifications_on_user_id"
  end

  create_table "chat_conversations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "title", default: "New chat", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id", "created_at", "id"], name: "index_chat_conversations_on_owner_history"
    t.index ["user_id"], name: "index_chat_conversations_on_user_id"
  end

  create_table "chat_execution_attempts", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "chat_operation_id", null: false
    t.uuid "attempt_id", null: false
    t.integer "claim_generation", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["attempt_id"], name: "index_chat_execution_attempts_on_attempt_id", unique: true
    t.index ["chat_operation_id"], name: "index_chat_execution_attempts_on_chat_operation_id"
  end

  create_table "chat_messages", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "chat_conversation_id", null: false
    t.integer "position", null: false
    t.string "role", null: false
    t.text "content", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "screened_sha256"
    t.boolean "thumbs_down", default: false, null: false
    t.index ["chat_conversation_id", "position"], name: "index_chat_messages_on_chat_conversation_id_and_position", unique: true
    t.index ["chat_conversation_id"], name: "index_chat_messages_on_chat_conversation_id"
    t.check_constraint "\"position\" > 0", name: "chat_message_positive_position"
    t.check_constraint "length(content) > 0", name: "chat_message_content_present"
    t.check_constraint "role::text = 'assistant'::text OR thumbs_down = false", name: "chat_feedback_assistant_only"
    t.check_constraint "role::text = ANY (ARRAY['user'::character varying::text, 'assistant'::character varying::text])", name: "chat_message_role"
  end

  create_table "chat_operations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "chat_conversation_id", null: false
    t.uuid "ai_task_id", null: false
    t.string "idempotency_key", null: false
    t.text "message", null: false
    t.string "status", default: "pending", null: false
    t.uuid "attempt_id"
    t.integer "claim_generation", default: 0, null: false
    t.integer "execution_count", default: 0, null: false
    t.integer "cycle_execution_count", default: 0, null: false
    t.integer "expected_position", default: 0, null: false
    t.datetime "lease_expires_at"
    t.datetime "execution_deadline"
    t.datetime "retry_at"
    t.datetime "retry_expires_at", null: false
    t.string "failure_code"
    t.string "delivery_job_id"
    t.string "recovery_job_id"
    t.string "result_fingerprint"
    t.jsonb "accepted_result", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["ai_task_id"], name: "index_chat_operations_on_ai_task_id"
    t.index ["chat_conversation_id", "idempotency_key"], name: "index_chat_operations_on_idempotency", unique: true
    t.index ["chat_conversation_id"], name: "index_chat_operations_on_chat_conversation_id"
    t.index ["chat_conversation_id"], name: "index_chat_operations_one_active", unique: true, where: "((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('running'::character varying)::text]))"
    t.check_constraint "length(message) > 0", name: "chat_operation_message"
    t.check_constraint "status::text = ANY (ARRAY['pending'::character varying::text, 'running'::character varying::text, 'accepted'::character varying::text, 'failed'::character varying::text])", name: "chat_operation_status"
  end

  create_table "chat_provider_attempts", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "chat_execution_attempt_id", null: false
    t.uuid "observation_id", null: false
    t.string "stage", null: false
    t.string "provider", null: false
    t.string "model", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["chat_execution_attempt_id"], name: "index_chat_provider_attempts_on_chat_execution_attempt_id"
    t.index ["observation_id"], name: "index_chat_provider_attempts_on_observation_id", unique: true
  end

  create_table "educations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "institution", null: false
    t.string "degree"
    t.string "field_of_study"
    t.date "start_date"
    t.date "end_date"
    t.text "description"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["user_id"], name: "index_educations_on_user_id"
  end

  create_table "experience_highlights", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "experience_id", null: false
    t.text "content", null: false
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["experience_id"], name: "index_experience_highlights_on_experience_id"
  end

  create_table "experiences", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "company", null: false
    t.string "title", null: false
    t.string "location"
    t.date "start_date"
    t.date "end_date"
    t.text "description"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["user_id"], name: "index_experiences_on_user_id"
  end

  create_table "interview_career_references", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_session_id", null: false
    t.uuid "message_id", null: false
    t.uuid "ai_task_id"
    t.integer "attempt_count", default: 0, null: false
    t.datetime "claimed_at"
    t.datetime "deadline"
    t.jsonb "references", default: [], null: false
    t.string "policy_version", default: "1", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["ai_task_id"], name: "index_interview_career_references_on_ai_task_id"
    t.index ["interview_session_id"], name: "index_interview_career_references_on_interview_session_id"
    t.index ["message_id"], name: "index_interview_career_references_on_message_id", unique: true
    t.check_constraint "attempt_count >= 0 AND attempt_count <= 2 AND jsonb_typeof(\"references\") = 'array'::text AND jsonb_array_length(\"references\") <= 3", name: "interview_career_reference_bounds"
  end

  create_table "interview_clarifications", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_session_id", null: false
    t.uuid "message_id", null: false
    t.uuid "ai_task_id"
    t.integer "attempt_count", default: 0, null: false
    t.datetime "claimed_at"
    t.datetime "deadline"
    t.text "explanation"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["ai_task_id"], name: "index_interview_clarifications_on_ai_task_id"
    t.index ["interview_session_id"], name: "index_interview_clarifications_on_interview_session_id"
    t.index ["message_id"], name: "index_interview_clarifications_on_message_id", unique: true
    t.check_constraint "attempt_count >= 0 AND attempt_count <= 2 AND (explanation IS NULL OR char_length(explanation) >= 1 AND char_length(explanation) <= 1000)", name: "interview_clarification_bounds"
  end

  create_table "interview_execution_attempts", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "operation_id", null: false
    t.uuid "attempt_id", null: false
    t.integer "claim_generation", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["attempt_id"], name: "index_interview_execution_attempts_on_attempt_id", unique: true
    t.index ["operation_id", "claim_generation"], name: "idx_on_operation_id_claim_generation_54803b5c75", unique: true
    t.index ["operation_id"], name: "index_interview_execution_attempts_on_operation_id"
  end

  create_table "interview_provider_attempts", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "execution_attempt_id", null: false
    t.uuid "observation_id", null: false
    t.string "stage", null: false
    t.string "provider", null: false
    t.string "model", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["execution_attempt_id"], name: "index_interview_provider_attempts_on_execution_attempt_id"
    t.index ["observation_id"], name: "index_interview_provider_attempts_on_observation_id", unique: true
  end

  create_table "interview_question_embeddings", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_question_id", null: false
    t.text "content", null: false
    t.string "content_digest", null: false
    t.string "model", null: false
    t.vector "embedding", limit: 1536, null: false
    t.integer "question_revision", null: false
    t.integer "answer_revision", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["interview_question_id"], name: "index_interview_question_embeddings_on_interview_question_id", unique: true
    t.check_constraint "question_revision > 0 AND answer_revision >= 0", name: "interview_embedding_revisions_valid"
  end

  create_table "interview_question_sets", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.integer "number", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "set_type", default: "general", null: false
    t.index ["user_id", "number"], name: "index_interview_question_sets_on_user_id_and_number", unique: true
    t.index ["user_id"], name: "index_interview_question_sets_on_user_id"
    t.check_constraint "number > 0", name: "interview_set_positive_number"
    t.check_constraint "set_type::text = ANY (ARRAY['general'::character varying::text, 'technical'::character varying::text, 'knowledge'::character varying::text])", name: "interview_question_sets_valid_set_type"
  end

  create_table "interview_questions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_question_set_id", null: false
    t.integer "position", null: false
    t.text "question_text", null: false
    t.text "answer_text", default: "", null: false
    t.integer "question_revision", default: 1, null: false
    t.integer "answer_revision", default: 0, null: false
    t.jsonb "feedback", default: {}, null: false
    t.integer "feedback_question_revision"
    t.integer "feedback_answer_revision"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["interview_question_set_id", "position"], name: "idx_on_interview_question_set_id_position_e4061dd6c2", unique: true
    t.index ["interview_question_set_id"], name: "index_interview_questions_on_interview_question_set_id"
    t.check_constraint "\"position\" >= 1 AND \"position\" <= 5", name: "interview_question_position"
    t.check_constraint "question_revision > 0 AND answer_revision >= 0", name: "interview_question_revisions"
  end

  create_table "interview_session_media", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_session_id"
    t.uuid "question_id"
    t.uuid "operation_id"
    t.uuid "message_id"
    t.string "kind", null: false
    t.string "status", default: "reserved", null: false
    t.string "staging_key"
    t.string "sealed_key"
    t.string "content_type", null: false
    t.bigint "byte_size"
    t.string "checksum"
    t.uuid "attempt_id"
    t.integer "claim_generation"
    t.datetime "expires_at", null: false
    t.datetime "deleted_at"
    t.integer "deletion_attempts", default: 0, null: false
    t.datetime "next_delete_at"
    t.string "last_delete_error"
    t.jsonb "metadata", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["expires_at"], name: "index_interview_session_media_on_expires_at"
    t.index ["interview_session_id"], name: "index_interview_session_media_on_interview_session_id"
    t.index ["message_id"], name: "index_interview_session_media_on_message_id"
    t.index ["operation_id", "attempt_id"], name: "index_interview_session_media_on_operation_id_and_attempt_id", unique: true, where: "((kind)::text = 'speech'::text)"
    t.index ["operation_id"], name: "index_interview_session_media_on_operation_id"
    t.index ["question_id"], name: "index_interview_session_media_on_question_id"
    t.index ["sealed_key"], name: "index_interview_session_media_on_sealed_key", unique: true
    t.index ["staging_key"], name: "index_interview_session_media_on_staging_key", unique: true
    t.check_constraint "byte_size IS NULL OR byte_size > 0", name: "interview_media_bytes"
    t.check_constraint "deletion_attempts >= 0", name: "interview_media_deletions"
    t.check_constraint "interview_session_id IS NOT NULL AND question_id IS NOT NULL AND (kind::text = 'recording'::text OR kind::text = 'speech'::text AND operation_id IS NOT NULL AND message_id IS NOT NULL AND attempt_id IS NOT NULL AND claim_generation IS NOT NULL) OR interview_session_id IS NULL AND question_id IS NULL AND operation_id IS NULL AND message_id IS NULL AND attempt_id IS NULL AND claim_generation IS NULL AND (status::text = ANY (ARRAY['delete_pending'::character varying::text, 'deleted'::character varying::text])) AND metadata = '{}'::jsonb AND checksum IS NULL AND byte_size IS NULL AND (staging_key IS NOT NULL OR sealed_key IS NOT NULL)", name: "interview_media_identity"
    t.check_constraint "kind::text = ANY (ARRAY['recording'::character varying::text, 'speech'::character varying::text])", name: "interview_media_kind"
    t.check_constraint "status::text = ANY (ARRAY['reserved'::character varying::text, 'ready'::character varying::text, 'delete_pending'::character varying::text, 'deleted'::character varying::text])", name: "interview_media_status"
  end

  create_table "interview_session_messages", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_session_id", null: false
    t.uuid "question_id", null: false
    t.integer "position", null: false
    t.string "kind", null: false
    t.string "semantic_key", null: false
    t.text "content", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "acknowledgement"
    t.index ["interview_session_id", "id"], name: "interview_message_session_identity", unique: true
    t.index ["interview_session_id", "position"], name: "idx_on_interview_session_id_position_fb18f0ea41", unique: true
    t.index ["interview_session_id", "question_id", "id"], name: "interview_session_message_owner_identity", unique: true
    t.index ["interview_session_id", "semantic_key"], name: "idx_on_interview_session_id_semantic_key_fd3956ac09", unique: true
    t.index ["interview_session_id"], name: "index_interview_session_messages_on_interview_session_id"
    t.index ["question_id"], name: "index_interview_session_messages_on_question_id"
    t.index ["question_id"], name: "interview_session_one_opening_per_question", unique: true, where: "((kind)::text = 'opening'::text)"
    t.check_constraint "\"position\" >= 0 AND (kind::text = ANY (ARRAY['opening'::character varying::text, 'answer'::character varying::text, 'follow_up'::character varying::text, 'closing'::character varying::text]))", name: "interview_session_message_kind"
    t.check_constraint "acknowledgement IS NULL OR kind::text <> 'answer'::text AND char_length(acknowledgement) >= 1 AND char_length(acknowledgement) <= 280 AND btrim(acknowledgement) <> ''::text", name: "interview_message_acknowledgement"
  end

  create_table "interview_session_operations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_session_id", null: false
    t.uuid "question_id"
    t.uuid "message_id"
    t.string "kind", null: false
    t.string "status", default: "pending", null: false
    t.string "submission_key"
    t.string "request_fingerprint"
    t.uuid "recording_id"
    t.integer "expected_revision"
    t.integer "claim_generation", default: 0, null: false
    t.uuid "attempt_id"
    t.datetime "lease_expires_at"
    t.datetime "execution_deadline"
    t.string "result_fingerprint"
    t.jsonb "accepted_result", default: {}, null: false
    t.datetime "accepted_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.uuid "ai_task_id"
    t.integer "execution_count", default: 0, null: false
    t.integer "cycle_execution_count", default: 0, null: false
    t.datetime "retry_at"
    t.datetime "retry_expires_at"
    t.string "failure_code"
    t.string "checkpoint"
    t.text "candidate_transcript"
    t.string "transcription_mode", default: "recorded", null: false
    t.uuid "recovery_job_id"
    t.uuid "delivery_job_id"
    t.index ["ai_task_id"], name: "interview_operation_unique_task", unique: true
    t.index ["interview_session_id", "question_id", "id"], name: "interview_operation_media_identity", unique: true
    t.index ["interview_session_id", "submission_key"], name: "interview_session_submission_identity", unique: true, where: "((kind)::text = 'turn'::text)"
    t.index ["interview_session_id"], name: "index_interview_session_operations_on_interview_session_id"
    t.index ["interview_session_id"], name: "interview_one_preparation", unique: true, where: "((kind)::text = 'preparation'::text)"
    t.index ["interview_session_id"], name: "interview_session_one_active_turn", unique: true, where: "(((kind)::text = 'turn'::text) AND ((status)::text = ANY (ARRAY[('pending'::character varying)::text, ('running'::character varying)::text])))"
    t.index ["message_id"], name: "index_interview_session_operations_on_message_id"
    t.index ["message_id"], name: "interview_session_one_speech_per_message", unique: true, where: "((kind)::text = 'speech'::text)"
    t.index ["question_id"], name: "index_interview_session_operations_on_question_id"
    t.index ["recording_id"], name: "interview_one_recorded_transcription", unique: true, where: "((kind)::text = 'transcription'::text)"
    t.check_constraint "(kind::text = ANY (ARRAY['preparation'::character varying::text, 'turn'::character varying::text, 'speech'::character varying::text, 'transcription'::character varying::text])) AND (status::text = ANY (ARRAY['pending'::character varying::text, 'running'::character varying::text, 'accepted'::character varying::text, 'failed'::character varying::text, 'expired'::character varying::text])) AND claim_generation >= 0", name: "interview_session_operation_states"
    t.check_constraint "candidate_transcript IS NULL OR char_length(candidate_transcript) >= 1 AND char_length(candidate_transcript) <= 4000 AND transcription_mode::text <> 'recorded'::text", name: "interview_operation_candidate_transcript"
    t.check_constraint "execution_count >= 0 AND execution_count <= 6 AND cycle_execution_count >= 0 AND cycle_execution_count <= 3", name: "interview_operation_execution_caps"
    t.check_constraint "kind::text = 'preparation'::text AND question_id IS NULL AND message_id IS NULL AND recording_id IS NULL AND submission_key IS NULL OR kind::text = 'turn'::text AND question_id IS NOT NULL AND submission_key IS NOT NULL AND request_fingerprint IS NOT NULL AND (recording_id IS NOT NULL OR transcription_mode::text = 'typed'::text) AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL OR kind::text = 'speech'::text AND question_id IS NOT NULL AND message_id IS NOT NULL AND submission_key IS NULL OR kind::text = 'transcription'::text AND question_id IS NOT NULL AND recording_id IS NOT NULL AND expected_revision IS NOT NULL AND expected_revision >= 0 AND message_id IS NULL AND submission_key IS NULL", name: "interview_session_operation_inputs"
    t.check_constraint "status::text <> 'accepted'::text OR accepted_at IS NOT NULL AND result_fingerprint IS NOT NULL", name: "interview_session_operation_accepted_result"
    t.check_constraint "status::text <> 'running'::text OR claim_generation > 0 AND attempt_id IS NOT NULL AND lease_expires_at IS NOT NULL AND execution_deadline IS NOT NULL", name: "interview_session_operation_claim"
    t.check_constraint "transcription_mode::text = ANY (ARRAY['recorded'::character varying::text, 'browser'::character varying::text, 'streaming'::character varying::text, 'typed'::character varying::text])", name: "interview_operation_transcription_mode"
  end

  create_table "interview_session_questions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_session_id", null: false
    t.integer "position", null: false
    t.text "content", null: false
    t.integer "accepted_answer_count", default: 0, null: false
    t.integer "history_version", default: 1, null: false
    t.jsonb "model_history", default: [], null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.string "question_type", default: "behavioral", null: false
    t.datetime "skipped_at"
    t.string "skip_submission_key"
    t.integer "skip_expected_revision"
    t.index ["interview_session_id", "id"], name: "interview_session_question_owner_identity", unique: true
    t.index ["interview_session_id", "position"], name: "idx_on_interview_session_id_position_ef5940a581", unique: true
    t.index ["interview_session_id", "skip_submission_key"], name: "interview_question_skip_identity", unique: true
    t.index ["interview_session_id"], name: "index_interview_session_questions_on_interview_session_id"
    t.check_constraint "\"position\" >= 0 AND accepted_answer_count >= 0 AND accepted_answer_count <= 3 AND history_version > 0", name: "interview_session_question_counters"
    t.check_constraint "jsonb_typeof(model_history) = 'array'::text", name: "interview_session_question_history_array"
    t.check_constraint "question_type::text = ANY (ARRAY['behavioral'::character varying::text, 'technical'::character varying::text, 'knowledge'::character varying::text, 'screening'::character varying::text])", name: "interview_question_type"
  end

  create_table "interview_sessions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "status", default: "active", null: false
    t.string "interview_type", default: "basic", null: false
    t.integer "revision", default: 0, null: false
    t.integer "current_question_position", default: 0, null: false
    t.integer "answer_cap", default: 2, null: false
    t.jsonb "fixture_context", default: {}, null: false
    t.datetime "expires_at", null: false
    t.datetime "completed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.datetime "content_purged_at"
    t.string "execution_mode", default: "fake", null: false
    t.jsonb "execution_config", default: {"voice" => "espeak", "speech_model" => "fake-speech-v1", "interviewer_model" => "fake-interviewer-v1", "transcription_model" => "fake-transcription-v1"}, null: false
    t.jsonb "frozen_context", default: {}, null: false
    t.jsonb "prepared_role", default: {}, null: false
    t.jsonb "setup_config", default: {}, null: false
    t.uuid "job_id"
    t.index ["job_id"], name: "index_interview_sessions_on_job_id"
    t.index ["user_id"], name: "index_interview_sessions_on_user_id"
    t.check_constraint "execution_mode::text = 'fake'::text AND execution_config = '{\"voice\": \"espeak\", \"speech_model\": \"fake-speech-v1\", \"interviewer_model\": \"fake-interviewer-v1\", \"transcription_model\": \"fake-transcription-v1\"}'::jsonb OR execution_mode::text = 'real'::text AND execution_config = '{\"voice\": \"marin\", \"speech_model\": \"gpt-4o-mini-tts\", \"interviewer_model\": \"gpt-6-luna\", \"transcription_model\": \"gpt-transcribe\"}'::jsonb", name: "interview_execution_configuration"
    t.check_constraint "interview_type::text = 'basic'::text", name: "interview_session_type"
    t.check_constraint "revision >= 0 AND current_question_position >= 0 AND answer_cap >= 1 AND answer_cap <= 3", name: "interview_session_counters"
    t.check_constraint "status::text = ANY (ARRAY['preparing'::character varying::text, 'ready'::character varying::text, 'active'::character varying::text, 'completed'::character varying::text, 'expired'::character varying::text, 'abandoned'::character varying::text])", name: "interview_session_status"
  end

  create_table "interview_transcription_captures", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "interview_session_id", null: false
    t.uuid "question_id", null: false
    t.uuid "ai_task_id"
    t.integer "expected_revision", null: false
    t.string "status", default: "authorized", null: false
    t.string "token_digest", null: false
    t.uuid "observation_id", null: false
    t.datetime "expires_at", null: false
    t.text "transcript"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["ai_task_id"], name: "index_interview_transcription_captures_on_ai_task_id"
    t.index ["interview_session_id"], name: "index_interview_transcription_captures_on_interview_session_id"
    t.index ["observation_id"], name: "index_interview_transcription_captures_on_observation_id", unique: true
    t.index ["question_id"], name: "index_interview_transcription_captures_on_question_id"
    t.index ["token_digest"], name: "index_interview_transcription_captures_on_token_digest", unique: true
    t.check_constraint "expected_revision >= 0 AND (transcript IS NULL OR char_length(transcript) <= 4000)", name: "interview_capture_limits"
    t.check_constraint "status::text = ANY (ARRAY['authorized'::character varying::text, 'streaming'::character varying::text, 'completed'::character varying::text, 'failed'::character varying::text])", name: "interview_capture_status"
  end

  create_table "interview_verification_reservations", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "observation_id", null: false
    t.bigint "reserved_microdollars", null: false
    t.bigint "actual_microdollars"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["observation_id"], name: "index_interview_verification_reservations_on_observation_id", unique: true
    t.check_constraint "reserved_microdollars > 0 AND (actual_microdollars IS NULL OR actual_microdollars >= 0)", name: "interview_verification_nonnegative_costs"
  end

  create_table "job_board_listings", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.bigint "provider_id", null: false
    t.jsonb "payload", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["provider_id"], name: "index_job_board_listings_on_provider_id", unique: true
  end

  create_table "job_board_search_pages", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "query_digest", null: false
    t.string "keyword", null: false
    t.boolean "remote_only", default: false, null: false
    t.text "cursor"
    t.uuid "listing_ids", default: [], null: false, array: true
    t.text "next_cursor"
    t.datetime "retrieved_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["query_digest"], name: "index_job_board_search_pages_on_query_digest", unique: true
  end

  create_table "job_gap_responses", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "job_id", null: false
    t.text "requirement", null: false
    t.text "body", null: false
    t.uuid "library_fact_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["job_id", "requirement"], name: "index_job_gap_responses_on_job_id_and_requirement", unique: true
    t.index ["job_id"], name: "index_job_gap_responses_on_job_id"
    t.index ["library_fact_id"], name: "index_job_gap_responses_on_library_fact_id"
  end

  create_table "jobs", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "title", null: false
    t.string "company"
    t.string "location"
    t.string "url"
    t.text "description"
    t.jsonb "requirements", default: [], null: false
    t.jsonb "nice_to_haves", default: [], null: false
    t.string "stage", default: "unapplied", null: false
    t.datetime "applied_at"
    t.text "notes"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.jsonb "responsibilities", default: [], null: false
    t.uuid "job_board_listing_id"
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["job_board_listing_id"], name: "index_jobs_on_job_board_listing_id"
    t.index ["user_id", "job_board_listing_id"], name: "index_jobs_on_user_id_and_job_board_listing_id", unique: true
    t.index ["user_id", "stage"], name: "index_jobs_on_user_id_and_stage"
    t.index ["user_id"], name: "index_jobs_on_user_id"
  end

  create_table "jwt_denylists", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "jti", null: false
    t.datetime "exp", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["jti"], name: "index_jwt_denylists_on_jti", unique: true
  end

  create_table "library_embeddings", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "source_type", null: false
    t.uuid "source_id", null: false
    t.text "content", null: false
    t.string "content_digest", null: false
    t.string "model", null: false
    t.vector "embedding", limit: 1536, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["embedding"], name: "index_library_embeddings_on_embedding", opclass: :vector_cosine_ops, using: :hnsw
    t.index ["source_type", "source_id"], name: "index_library_embeddings_on_source_type_and_source_id", unique: true
    t.index ["user_id"], name: "index_library_embeddings_on_user_id"
  end

  create_table "library_facts", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.text "requirement", null: false
    t.text "response", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["user_id", "requirement"], name: "index_library_facts_on_user_id_and_requirement", unique: true
    t.index ["user_id"], name: "index_library_facts_on_user_id"
  end

  create_table "projects", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "name", null: false
    t.string "role"
    t.string "url"
    t.text "description"
    t.date "start_date"
    t.date "end_date"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["user_id"], name: "index_projects_on_user_id"
  end

  create_table "resume_sections", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "resume_id", null: false
    t.string "section_type", null: false
    t.string "title", null: false
    t.integer "position", default: 0, null: false
    t.jsonb "content", default: {}, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["resume_id"], name: "index_resume_sections_on_resume_id"
  end

  create_table "resumes", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.uuid "job_id"
    t.string "title", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "markdown"
    t.integer "target_pages"
    t.index ["job_id"], name: "index_resumes_on_job_id"
    t.index ["user_id"], name: "index_resumes_on_user_id"
    t.check_constraint "target_pages = ANY (ARRAY[1, 2])", name: "resumes_target_pages_valid"
  end

  create_table "sessions", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "session_id", null: false
    t.text "data"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["session_id"], name: "index_sessions_on_session_id", unique: true
    t.index ["updated_at"], name: "index_sessions_on_updated_at"
  end

  create_table "skills", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "name", null: false
    t.string "category"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.text "screened_fields", default: [], null: false, array: true
    t.index ["user_id", "name"], name: "index_skills_on_user_id_and_name", unique: true
    t.index ["user_id"], name: "index_skills_on_user_id"
  end

  create_table "solid_queue_batch_executions", force: :cascade do |t|
    t.bigint "job_id", null: false
    t.bigint "batch_id", null: false
    t.datetime "created_at", null: false
    t.index ["batch_id"], name: "index_solid_queue_batch_executions_on_batch_id"
    t.index ["job_id"], name: "index_solid_queue_batch_executions_on_job_id", unique: true
  end

  create_table "solid_queue_batches", force: :cascade do |t|
    t.string "active_job_batch_id"
    t.string "description"
    t.text "on_finish"
    t.text "on_success"
    t.text "on_failure"
    t.text "metadata"
    t.integer "total_jobs", default: 0, null: false
    t.integer "completed_jobs", default: 0, null: false
    t.integer "failed_jobs", default: 0, null: false
    t.datetime "enqueued_at"
    t.datetime "finished_at"
    t.datetime "failed_at"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["active_job_batch_id"], name: "index_solid_queue_batches_on_active_job_batch_id", unique: true
    t.index ["finished_at"], name: "index_solid_queue_batches_on_finished_at"
  end

  create_table "solid_queue_blocked_executions", force: :cascade do |t|
    t.bigint "job_id", null: false
    t.string "queue_name", null: false
    t.integer "priority", default: 0, null: false
    t.string "concurrency_key", null: false
    t.datetime "expires_at", null: false
    t.datetime "created_at", null: false
    t.index ["concurrency_key", "priority", "job_id"], name: "index_solid_queue_blocked_executions_for_release"
    t.index ["expires_at", "concurrency_key"], name: "index_solid_queue_blocked_executions_for_maintenance"
    t.index ["job_id"], name: "index_solid_queue_blocked_executions_on_job_id", unique: true
  end

  create_table "solid_queue_claimed_executions", force: :cascade do |t|
    t.bigint "job_id", null: false
    t.bigint "process_id"
    t.datetime "created_at", null: false
    t.index ["job_id"], name: "index_solid_queue_claimed_executions_on_job_id", unique: true
    t.index ["process_id", "job_id"], name: "index_solid_queue_claimed_executions_on_process_id_and_job_id"
  end

  create_table "solid_queue_failed_executions", force: :cascade do |t|
    t.bigint "job_id", null: false
    t.text "error"
    t.datetime "created_at", null: false
    t.index ["job_id"], name: "index_solid_queue_failed_executions_on_job_id", unique: true
  end

  create_table "solid_queue_jobs", force: :cascade do |t|
    t.string "queue_name", null: false
    t.string "class_name", null: false
    t.text "arguments"
    t.integer "priority", default: 0, null: false
    t.string "active_job_id"
    t.datetime "scheduled_at"
    t.datetime "finished_at"
    t.string "concurrency_key"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "batch_id"
    t.index ["active_job_id"], name: "index_solid_queue_jobs_on_active_job_id"
    t.index ["batch_id"], name: "index_solid_queue_jobs_on_batch_id"
    t.index ["class_name"], name: "index_solid_queue_jobs_on_class_name"
    t.index ["finished_at"], name: "index_solid_queue_jobs_on_finished_at"
    t.index ["queue_name", "finished_at"], name: "index_solid_queue_jobs_for_filtering"
    t.index ["scheduled_at", "finished_at"], name: "index_solid_queue_jobs_for_alerting"
  end

  create_table "solid_queue_pauses", force: :cascade do |t|
    t.string "queue_name", null: false
    t.datetime "created_at", null: false
    t.index ["queue_name"], name: "index_solid_queue_pauses_on_queue_name", unique: true
  end

  create_table "solid_queue_processes", force: :cascade do |t|
    t.string "kind", null: false
    t.datetime "last_heartbeat_at", null: false
    t.bigint "supervisor_id"
    t.integer "pid", null: false
    t.string "hostname"
    t.text "metadata"
    t.datetime "created_at", null: false
    t.string "name", null: false
    t.index ["last_heartbeat_at"], name: "index_solid_queue_processes_on_last_heartbeat_at"
    t.index ["name", "supervisor_id"], name: "index_solid_queue_processes_on_name_and_supervisor_id", unique: true
    t.index ["supervisor_id"], name: "index_solid_queue_processes_on_supervisor_id"
  end

  create_table "solid_queue_ready_executions", force: :cascade do |t|
    t.bigint "job_id", null: false
    t.string "queue_name", null: false
    t.integer "priority", default: 0, null: false
    t.datetime "created_at", null: false
    t.index ["job_id"], name: "index_solid_queue_ready_executions_on_job_id", unique: true
    t.index ["priority", "job_id"], name: "index_solid_queue_poll_all"
    t.index ["queue_name", "priority", "job_id"], name: "index_solid_queue_poll_by_queue"
  end

  create_table "solid_queue_recurring_executions", force: :cascade do |t|
    t.bigint "job_id", null: false
    t.string "task_key", null: false
    t.datetime "run_at", null: false
    t.datetime "created_at", null: false
    t.index ["job_id"], name: "index_solid_queue_recurring_executions_on_job_id", unique: true
    t.index ["task_key", "run_at"], name: "index_solid_queue_recurring_executions_on_task_key_and_run_at", unique: true
  end

  create_table "solid_queue_recurring_tasks", force: :cascade do |t|
    t.string "key", null: false
    t.string "schedule", null: false
    t.string "command", limit: 2048
    t.string "class_name"
    t.text "arguments"
    t.string "queue_name"
    t.integer "priority", default: 0
    t.boolean "static", default: true, null: false
    t.text "description"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["key"], name: "index_solid_queue_recurring_tasks_on_key", unique: true
    t.index ["static"], name: "index_solid_queue_recurring_tasks_on_static"
  end

  create_table "solid_queue_scheduled_executions", force: :cascade do |t|
    t.bigint "job_id", null: false
    t.string "queue_name", null: false
    t.integer "priority", default: 0, null: false
    t.datetime "scheduled_at", null: false
    t.datetime "created_at", null: false
    t.index ["job_id"], name: "index_solid_queue_scheduled_executions_on_job_id", unique: true
    t.index ["scheduled_at", "priority", "job_id"], name: "index_solid_queue_dispatch_all"
  end

  create_table "solid_queue_semaphores", force: :cascade do |t|
    t.string "key", null: false
    t.integer "value", default: 1, null: false
    t.datetime "expires_at", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["expires_at"], name: "index_solid_queue_semaphores_on_expires_at"
    t.index ["key", "value"], name: "index_solid_queue_semaphores_on_key_and_value"
    t.index ["key"], name: "index_solid_queue_semaphores_on_key", unique: true
  end

  create_table "users", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.string "email", default: "", null: false
    t.string "encrypted_password", default: "", null: false
    t.string "reset_password_token"
    t.datetime "reset_password_sent_at"
    t.datetime "remember_created_at"
    t.string "name"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.bigint "monthly_ai_budget_microdollars"
    t.integer "ai_tasks_per_hour_limit"
    t.integer "max_in_flight_ai_tasks"
    t.string "contact_email"
    t.string "phone"
    t.string "location"
    t.jsonb "links", default: [], null: false
    t.text "summary"
    t.text "screened_fields", default: [], null: false, array: true
    t.string "confirmation_token"
    t.datetime "confirmed_at"
    t.datetime "confirmation_sent_at"
    t.string "unconfirmed_email"
    t.index ["confirmation_token"], name: "index_users_on_confirmation_token", unique: true
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "ai_embedding_requests", "users", on_delete: :cascade
  add_foreign_key "ai_execution_stream_grants", "users", on_delete: :cascade
  add_foreign_key "ai_task_outcomes", "ai_tasks"
  add_foreign_key "ai_task_outcomes", "users"
  add_foreign_key "ai_tasks", "ai_tasks", column: "hourly_admission_task_id", on_delete: :nullify
  add_foreign_key "ai_tasks", "users"
  add_foreign_key "ai_usage_attempts", "ai_tasks"
  add_foreign_key "avoided_interview_questions", "users"
  add_foreign_key "certifications", "users"
  add_foreign_key "chat_conversations", "users"
  add_foreign_key "chat_execution_attempts", "chat_operations"
  add_foreign_key "chat_messages", "chat_conversations"
  add_foreign_key "chat_operations", "ai_tasks"
  add_foreign_key "chat_operations", "chat_conversations"
  add_foreign_key "chat_provider_attempts", "chat_execution_attempts"
  add_foreign_key "educations", "users"
  add_foreign_key "experience_highlights", "experiences", on_delete: :cascade
  add_foreign_key "experiences", "users"
  add_foreign_key "interview_career_references", "ai_tasks", on_delete: :nullify
  add_foreign_key "interview_career_references", "interview_session_messages", column: "message_id"
  add_foreign_key "interview_career_references", "interview_session_messages", column: ["interview_session_id", "message_id"], primary_key: ["interview_session_id", "id"]
  add_foreign_key "interview_career_references", "interview_sessions"
  add_foreign_key "interview_clarifications", "ai_tasks", on_delete: :nullify
  add_foreign_key "interview_clarifications", "interview_session_messages", column: "message_id"
  add_foreign_key "interview_clarifications", "interview_sessions"
  add_foreign_key "interview_execution_attempts", "interview_session_operations", column: "operation_id", on_delete: :cascade
  add_foreign_key "interview_provider_attempts", "interview_execution_attempts", column: "execution_attempt_id", on_delete: :cascade
  add_foreign_key "interview_question_embeddings", "interview_questions", on_delete: :cascade
  add_foreign_key "interview_question_sets", "users"
  add_foreign_key "interview_questions", "interview_question_sets"
  add_foreign_key "interview_session_media", "interview_session_messages", column: "message_id"
  add_foreign_key "interview_session_media", "interview_session_messages", column: ["interview_session_id", "question_id", "message_id"], primary_key: ["interview_session_id", "question_id", "id"], name: "interview_media_owned_message"
  add_foreign_key "interview_session_media", "interview_session_operations", column: "operation_id"
  add_foreign_key "interview_session_media", "interview_session_operations", column: ["interview_session_id", "question_id", "operation_id"], primary_key: ["interview_session_id", "question_id", "id"], name: "interview_media_owned_operation"
  add_foreign_key "interview_session_media", "interview_session_questions", column: "question_id"
  add_foreign_key "interview_session_media", "interview_session_questions", column: ["interview_session_id", "question_id"], primary_key: ["interview_session_id", "id"], name: "interview_media_owned_question"
  add_foreign_key "interview_session_media", "interview_sessions"
  add_foreign_key "interview_session_messages", "interview_session_questions", column: "question_id", on_delete: :cascade
  add_foreign_key "interview_session_messages", "interview_session_questions", column: ["interview_session_id", "question_id"], primary_key: ["interview_session_id", "id"], name: "interview_session_message_owned_question", on_delete: :cascade
  add_foreign_key "interview_session_messages", "interview_sessions", on_delete: :cascade
  add_foreign_key "interview_session_operations", "ai_tasks", on_delete: :nullify
  add_foreign_key "interview_session_operations", "interview_session_messages", column: "message_id", on_delete: :cascade
  add_foreign_key "interview_session_operations", "interview_session_messages", column: ["interview_session_id", "question_id", "message_id"], primary_key: ["interview_session_id", "question_id", "id"], name: "interview_session_operation_owned_message", on_delete: :cascade
  add_foreign_key "interview_session_operations", "interview_session_questions", column: "question_id", on_delete: :cascade
  add_foreign_key "interview_session_operations", "interview_session_questions", column: ["interview_session_id", "question_id"], primary_key: ["interview_session_id", "id"], name: "interview_session_operation_owned_question", on_delete: :cascade
  add_foreign_key "interview_session_operations", "interview_sessions", on_delete: :cascade
  add_foreign_key "interview_session_questions", "interview_sessions", on_delete: :cascade
  add_foreign_key "interview_sessions", "jobs", on_delete: :nullify
  add_foreign_key "interview_sessions", "users"
  add_foreign_key "interview_transcription_captures", "ai_tasks"
  add_foreign_key "interview_transcription_captures", "interview_session_questions", column: "question_id"
  add_foreign_key "interview_transcription_captures", "interview_sessions"
  add_foreign_key "job_gap_responses", "jobs"
  add_foreign_key "job_gap_responses", "library_facts", on_delete: :nullify
  add_foreign_key "jobs", "job_board_listings", on_delete: :nullify
  add_foreign_key "jobs", "users"
  add_foreign_key "library_embeddings", "users", on_delete: :cascade
  add_foreign_key "library_facts", "users"
  add_foreign_key "projects", "users"
  add_foreign_key "resume_sections", "resumes", on_delete: :cascade
  add_foreign_key "resumes", "jobs", on_delete: :nullify
  add_foreign_key "resumes", "users"
  add_foreign_key "skills", "users"
  add_foreign_key "solid_queue_batch_executions", "solid_queue_batches", column: "batch_id", on_delete: :cascade
  add_foreign_key "solid_queue_batch_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_blocked_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_claimed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_failed_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_ready_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_recurring_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
  add_foreign_key "solid_queue_scheduled_executions", "solid_queue_jobs", column: "job_id", on_delete: :cascade
end
