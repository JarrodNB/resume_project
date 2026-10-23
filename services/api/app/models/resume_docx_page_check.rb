# Stores pagination metadata and a private-object cleanup obligation, never document contents.
class ResumeDocxPageCheck < ApplicationRecord
  STATUSES = %w[queued running completed failed].freeze
  belongs_to :user, optional: true
  belongs_to :resume, optional: true
  enum :status, STATUSES.index_with(&:itself), validate: true
  validates :content_digest, format: { with: /\A[0-9a-f]{64}\z/ }
  validates :expires_at, presence: true
end
