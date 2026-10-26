# Saved evidence for one interviewer prompt; provider execution remains on its linked task.
class InterviewCareerReferences < ApplicationRecord
  include PublishesInterviewSnapshot
  belongs_to :interview_session
  belongs_to :message, class_name: "InterviewSessionMessage"
  belongs_to :ai_task, optional: true
  validates :attempt_count, inclusion: { in: 0..2 }
end
