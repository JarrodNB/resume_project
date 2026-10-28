# Retained coaching and execution identity for one completed interview. Dialogue stays separate.
class InterviewSessionFeedback < ApplicationRecord
  include PublishesInterviewSnapshot
  belongs_to :interview_session
  belongs_to :ai_task, optional: true
  validates :attempt_count, inclusion: { in: 0..2 }
end
