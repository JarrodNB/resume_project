# One saved explanation for a question-only message; its task changes only on explicit retry.
class InterviewClarification < ApplicationRecord
  include PublishesInterviewSnapshot
  belongs_to :interview_session
  belongs_to :message, class_name: "InterviewSessionMessage"
  belongs_to :ai_task, optional: true
  validates :attempt_count, inclusion: { in: 0..2 }
  validates :explanation, length: { maximum: 1000 }, allow_nil: true
end
