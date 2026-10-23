# Keeps a cleanup tombstone until an interrupted upload can no longer commit bytes.
class AddUploadExpiryToResumeDocxPageChecks < ActiveRecord::Migration[8.1]
  def change
    add_column :resume_docx_page_checks, :upload_expires_at, :datetime
  end
end
