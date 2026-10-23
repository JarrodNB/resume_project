# A short-lived permission to transcribe microphone input before an answer is submitted.
# Its task and observation preserve usage even when the recording or connection is lost.
class InterviewTranscriptionCapture < ApplicationRecord
  belongs_to :interview_session
  belongs_to :question, class_name: "InterviewSessionQuestion"
  belongs_to :ai_task, optional: true
  validates :status, inclusion: { in: %w[authorized streaming completed failed] }
  validates :token_digest, :observation_id, :expires_at, presence: true
end
