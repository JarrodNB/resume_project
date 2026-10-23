# Keeps private document cleanup obligations durable even after an account is removed.
class CreateResumeDocxPageChecks < ActiveRecord::Migration[8.1]
  def change
    create_table :resume_docx_page_checks, id: :uuid do |t|
      t.references :user, type: :uuid, foreign_key: { on_delete: :nullify }
      t.references :resume, type: :uuid, foreign_key: { on_delete: :nullify }
      t.string :content_digest, null: false
      t.string :status, null: false, default: "queued"
      t.string :storage_key
      t.boolean :upload_ready, null: false, default: false
      t.uuid :attempt_token
      t.datetime :lease_expires_at
      t.integer :page_count
      t.integer :retry_count, null: false, default: 0
      t.string :error_code
      t.datetime :last_cleanup_at
      t.datetime :expires_at, null: false
      t.timestamps
    end
    add_index :resume_docx_page_checks, [ :user_id, :content_digest ], unique: true
    add_index :resume_docx_page_checks, :expires_at
    add_check_constraint :resume_docx_page_checks, "status IN ('queued','running','completed','failed')", name: "docx_check_status"
    add_check_constraint :resume_docx_page_checks, "page_count IS NULL OR page_count > 0", name: "docx_positive_pages"
  end
end
