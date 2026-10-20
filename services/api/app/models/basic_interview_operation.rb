# Durable turn or saved-text speech work. A recording UUID is internal correlation only,
# never upload authority; media authorization belongs to the later media boundary.
class BasicInterviewOperation < ApplicationRecord
  KINDS = %w[turn speech].freeze
  STATUSES = %w[pending running accepted failed expired].freeze
  belongs_to :basic_interview
  belongs_to :question, class_name: "BasicInterviewQuestion"
  belongs_to :message, class_name: "BasicInterviewMessage", optional: true
  enum :kind, KINDS.index_with(&:itself), validate: true
  enum :status, STATUSES.index_with(&:itself), validate: true
  validates :submission_key, :recording_id, :request_fingerprint, :expected_revision, presence: true, if: :turn?
  validates :submission_key, length: { maximum: 200 }, allow_nil: true
  validates :message, presence: true, if: :speech?
  validates :claim_generation, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
end
