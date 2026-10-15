# Description: One execution's reported costs, retained independently of task completion.
# Index:
#   - ai_task: task whose known usage includes this report exactly once
#   - finalized: false until execution returns its final accounting report
class AiUsageAttempt < ApplicationRecord
  belongs_to :ai_task
  validates :attempt_id, presence: true, uniqueness: true
end
