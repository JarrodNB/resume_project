# A user-edited Markdown resume tailored to a job. Its job may later be deleted.
class Resume < ApplicationRecord
  MAX_MARKDOWN_LENGTH = 40_000

  belongs_to :user
  belongs_to :job, optional: true

  validates :title, presence: true
  validates :markdown, presence: true, length: { maximum: MAX_MARKDOWN_LENGTH }
  validates :target_pages, inclusion: { in: [ 1, 2 ] }
  # Only on create: deleting a job nullifies job_id, and its resumes must stay editable.
  validates :job, presence: true, on: :create
end
