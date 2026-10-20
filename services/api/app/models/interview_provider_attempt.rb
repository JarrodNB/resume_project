# Binds one provider billing identity to its persisted execution and immutable labels.
class InterviewProviderAttempt < ApplicationRecord
  belongs_to :execution_attempt, class_name: "InterviewExecutionAttempt"
end
