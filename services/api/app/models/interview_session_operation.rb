# Durable reviewed-text/audio turns or saved-text speech work. Recording UUIDs identify private media;
# services authorize sealed bytes and current claims before granting execution access.
class InterviewSessionOperation < ApplicationRecord
  include PublishesInterviewSnapshot
  KINDS = %w[preparation turn speech].freeze
  STATUSES = %w[pending running accepted failed expired].freeze
  belongs_to :interview_session
  belongs_to :ai_task, optional: true
  has_many :execution_attempts, class_name: "InterviewExecutionAttempt", foreign_key: :operation_id, dependent: :destroy
  belongs_to :question, class_name: "InterviewSessionQuestion", optional: true
  belongs_to :message, class_name: "InterviewSessionMessage", optional: true
  enum :kind, KINDS.index_with(&:itself), validate: true
  enum :status, STATUSES.index_with(&:itself), validate: true
  validates :submission_key, :request_fingerprint, :expected_revision, presence: true, if: :turn?
  validates :recording_id, presence: true, if: -> { turn? && !text_only? }
  validates :candidate_transcript, presence: true, on: :create, if: :text_only?
  validates :submission_key, length: { maximum: 200 }, allow_nil: true
  validates :message, presence: true, if: :speech?
  validates :claim_generation, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  # Reviewed text has no audio dependency; missing audio in any legacy mode is invalid.
  def text_only?
    turn? && transcription_mode == "typed" && recording_id.nil?
  end
end
