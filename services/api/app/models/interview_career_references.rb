# Saved evidence for one interviewer prompt; provider execution remains on its linked task.
class InterviewCareerReferences < ApplicationRecord
  include PublishesInterviewSnapshot
  belongs_to :interview_session
  belongs_to :message, class_name: "InterviewSessionMessage"
  belongs_to :ai_task, optional: true
  has_many :visits, class_name: "InterviewReferenceVisit", foreign_key: :career_references_id, dependent: :delete_all
  validates :attempt_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :retry_count, inclusion: { in: 0..1 }
end
