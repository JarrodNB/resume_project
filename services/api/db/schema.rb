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

ActiveRecord::Schema[8.1].define(version: 2026_10_10_030000) do
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
    t.index ["subject_type", "subject_id"], name: "index_ai_tasks_on_subject"
    t.index ["user_id", "created_at"], name: "index_ai_tasks_on_user_id_and_created_at"
    t.index ["user_id", "status"], name: "index_ai_tasks_on_user_id_and_status"
    t.index ["user_id"], name: "index_ai_tasks_on_user_id"
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
    t.index ["user_id"], name: "index_certifications_on_user_id"
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
    t.index ["user_id"], name: "index_educations_on_user_id"
  end

  create_table "experience_highlights", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "experience_id", null: false
    t.text "content", null: false
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
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
    t.index ["user_id"], name: "index_experiences_on_user_id"
  end

  create_table "interview_question_sets", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.integer "number", null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id", "number"], name: "index_interview_question_sets_on_user_id_and_number", unique: true
    t.index ["user_id"], name: "index_interview_question_sets_on_user_id"
    t.check_constraint "number > 0", name: "interview_set_positive_number"
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
    t.index ["interview_question_set_id", "position"], name: "idx_on_interview_question_set_id_position_e4061dd6c2", unique: true
    t.index ["interview_question_set_id"], name: "index_interview_questions_on_interview_question_set_id"
    t.check_constraint "\"position\" >= 1 AND \"position\" <= 5", name: "interview_question_position"
    t.check_constraint "question_revision > 0 AND answer_revision >= 0", name: "interview_question_revisions"
  end

  create_table "job_gap_responses", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "job_id", null: false
    t.text "requirement", null: false
    t.text "body", null: false
    t.uuid "library_fact_id"
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["job_id", "requirement"], name: "index_job_gap_responses_on_job_id_and_requirement", unique: true
    t.index ["job_id"], name: "index_job_gap_responses_on_job_id"
    t.index ["library_fact_id"], name: "index_job_gap_responses_on_library_fact_id"
  end

  create_table "jobs", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "title", null: false
    t.string "company", null: false
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
    t.index ["job_id"], name: "index_resumes_on_job_id"
    t.index ["user_id"], name: "index_resumes_on_user_id"
  end

  create_table "skills", id: :uuid, default: -> { "gen_random_uuid()" }, force: :cascade do |t|
    t.uuid "user_id", null: false
    t.string "name", null: false
    t.string "category"
    t.integer "position", default: 0, null: false
    t.datetime "created_at", null: false
    t.datetime "updated_at", null: false
    t.index ["user_id", "name"], name: "index_skills_on_user_id_and_name", unique: true
    t.index ["user_id"], name: "index_skills_on_user_id"
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
    t.index ["email"], name: "index_users_on_email", unique: true
    t.index ["reset_password_token"], name: "index_users_on_reset_password_token", unique: true
  end

  add_foreign_key "active_storage_attachments", "active_storage_blobs", column: "blob_id"
  add_foreign_key "active_storage_variant_records", "active_storage_blobs", column: "blob_id"
  add_foreign_key "ai_tasks", "users"
  add_foreign_key "certifications", "users"
  add_foreign_key "educations", "users"
  add_foreign_key "experience_highlights", "experiences", on_delete: :cascade
  add_foreign_key "experiences", "users"
  add_foreign_key "interview_question_sets", "users"
  add_foreign_key "interview_questions", "interview_question_sets"
  add_foreign_key "job_gap_responses", "jobs"
  add_foreign_key "job_gap_responses", "library_facts", on_delete: :nullify
  add_foreign_key "jobs", "users"
  add_foreign_key "library_embeddings", "users", on_delete: :cascade
  add_foreign_key "library_facts", "users"
  add_foreign_key "projects", "users"
  add_foreign_key "resume_sections", "resumes", on_delete: :cascade
  add_foreign_key "resumes", "jobs", on_delete: :nullify
  add_foreign_key "resumes", "users"
  add_foreign_key "skills", "users"
end
