# Description: One execution's reported costs, retained independently of task completion.
# Index:
#   - ai_task: task whose known usage includes this report exactly once
#   - usage_entries: one typed row per reported provider response, in reported order
#   - finalized: false until execution returns its final accounting report
class AiUsageAttempt < ApplicationRecord
  belongs_to :ai_task
  has_many :usage_entries, -> { order(:position) }, class_name: "AiUsageEntry", dependent: :delete_all
  validates :attempt_id, presence: true, uniqueness: true
end
