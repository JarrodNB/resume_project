# Description: A resume tailored to a job, built from the career library and the user's profile.
# It keeps working (with no job) if its job is deleted.
# Index:
#   - sections: ordered sections with JSON content snapshots
class Resume < ApplicationRecord
  belongs_to :user
  belongs_to :job, optional: true
  has_many :sections, -> { order(:position) },
           class_name: "ResumeSection", dependent: :destroy, inverse_of: :resume

  validates :title, presence: true
  # Only on create: deleting a job nullifies job_id, and its resumes must stay editable.
  validates :job, presence: true, on: :create
end
