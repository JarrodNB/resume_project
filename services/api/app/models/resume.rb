# Description: A resume tailored to a job, built from the career library and the user's profile.
# It keeps working (with no job) if its job is deleted.
# Index:
#   - sections: ordered sections with JSON content snapshots
class Resume < ApplicationRecord
  has_many :ats_check_runs, dependent: :destroy
  has_many :ai_tasks, as: :subject, dependent: :nullify
  belongs_to :user
  belongs_to :job, optional: true
  has_many :sections, -> { order(:position) },
           class_name: "ResumeSection", dependent: :destroy, inverse_of: :resume

  validates :title, presence: true
  # Only on create: deleting a job nullifies job_id, and its resumes must stay editable.
  validates :job, presence: true, on: :create
end
