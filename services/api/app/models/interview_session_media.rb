# Private media reservation and deletion receipt. Only interview services issue scoped
# upload/read capabilities; these objects never use public Active Storage signed routes.
# Detached rows retain only random keys and deletion bookkeeping after domain deletion.
class InterviewSessionMedia < ApplicationRecord
  KINDS = %w[recording speech].freeze
  STATUSES = %w[reserved ready delete_pending deleted].freeze
  self.table_name = "interview_session_media"
  belongs_to :interview_session, optional: true
  belongs_to :question, class_name: "InterviewSessionQuestion", optional: true
  belongs_to :operation, class_name: "InterviewSessionOperation", optional: true
  belongs_to :message, class_name: "InterviewSessionMessage", optional: true
  enum :kind, KINDS.index_with(&:itself), validate: true
  enum :status, STATUSES.index_with(&:itself), validate: true
  validates :content_type, :expires_at, presence: true
end
