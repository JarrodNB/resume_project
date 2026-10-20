# Rails-owned spoken interview session. Basic is the first supported interview type. Its services change dialogue and progress together;
# the existing written practice records remain independent.
class InterviewSession < ApplicationRecord
  STATUSES = %w[active completed expired].freeze
  INTERVIEW_TYPES = %w[basic].freeze
  belongs_to :user
  has_many :questions, -> { order(:position) }, class_name: "InterviewSessionQuestion", dependent: :destroy
  has_many :messages, -> { order(:position) }, class_name: "InterviewSessionMessage", dependent: :destroy
  has_many :operations, class_name: "InterviewSessionOperation", dependent: :destroy
  enum :status, STATUSES.index_with(&:itself), validate: true
  enum :interview_type, INTERVIEW_TYPES.index_with(&:itself), validate: true
  validates :expires_at, presence: true
  validates :revision, :current_question_position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :answer_cap, inclusion: { in: 1..2 }
end
