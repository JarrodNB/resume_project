# Durable turn or saved-text speech work. Recording UUIDs identify owned private media;
# services authorize sealed bytes and current claims before granting execution access.
class InterviewSessionOperation < ApplicationRecord
  KINDS = %w[turn speech].freeze
  STATUSES = %w[pending running accepted failed expired].freeze
  belongs_to :interview_session
  belongs_to :ai_task, optional: true
  has_many :execution_attempts, class_name: "InterviewExecutionAttempt", foreign_key: :operation_id, dependent: :destroy
  belongs_to :question, class_name: "InterviewSessionQuestion"
  belongs_to :message, class_name: "InterviewSessionMessage", optional: true
  enum :kind, KINDS.index_with(&:itself), validate: true
  enum :status, STATUSES.index_with(&:itself), validate: true
  validates :submission_key, :recording_id, :request_fingerprint, :expected_revision, presence: true, if: :turn?
  validates :submission_key, length: { maximum: 200 }, allow_nil: true
  validates :message, presence: true, if: :speech?
  validates :claim_generation, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
