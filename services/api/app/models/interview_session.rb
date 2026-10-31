# Rails-owned spoken interview session. Basic is the first supported interview type. Its services change dialogue and progress together;
# the existing written practice records remain independent.
class InterviewSession < ApplicationRecord
  include PublishesInterviewSnapshot
  before_destroy -> { Interviews::DetachMediaService.call(interview: self) }, prepend: true
  before_destroy -> { Interviews::SessionFeedback.new.purge(interview: self, reason: :deleted) }, prepend: true
  STATUSES = %w[preparing ready active completed expired abandoned].freeze
  INTERVIEW_TYPES = %w[basic].freeze
  attr_readonly :execution_mode, :execution_config, :setup_config, :preparation_kind
  validates :execution_mode, inclusion: { in: Interviews::ExecutionConfiguration::PRESETS.keys }
  validates :execution_config, inclusion: { in: ->(session) { [ Interviews::ExecutionConfiguration::PRESETS[session.execution_mode] ] } }
  validates :career_focus, length: { maximum: 200 }
  validates :preparation_kind, inclusion: { in: %w[saved_job fictional_role] }
  belongs_to :user
  belongs_to :job, optional: true
  has_one :feedback, class_name: "InterviewSessionFeedback", dependent: :destroy
  has_many :questions, -> { order(:position) }, class_name: "InterviewSessionQuestion", dependent: :destroy
  has_many :messages, -> { order(:position) }, class_name: "InterviewSessionMessage", dependent: :destroy
  has_many :career_references, class_name: "InterviewCareerReferences", dependent: :destroy
  has_many :clarifications, class_name: "InterviewClarification", dependent: :destroy
  has_many :operations, class_name: "InterviewSessionOperation", dependent: :destroy
  has_many :transcription_captures, class_name: "InterviewTranscriptionCapture", dependent: :destroy
  enum :status, STATUSES.index_with(&:itself), validate: true
  enum :interview_type, INTERVIEW_TYPES.index_with(&:itself), validate: true
  validates :expires_at, presence: true
  validates :revision, :current_question_position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :answer_cap, inclusion: { in: 1..3 }
end
