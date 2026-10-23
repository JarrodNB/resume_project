# Identifies a provider execution even after its claim has expired or been replaced.
class InterviewExecutionAttempt < ApplicationRecord
  belongs_to :operation, class_name: "InterviewSessionOperation"
  has_many :provider_attempts, class_name: "InterviewProviderAttempt", foreign_key: :execution_attempt_id, dependent: :destroy
end
