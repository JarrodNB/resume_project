# One saved success or failure of a task. Explicit retries can give one task several
# outcomes; these records contain no model input, generated text or provider errors.
class AiTaskOutcome < ApplicationRecord
  belongs_to :user
  belongs_to :ai_task
  attr_readonly :user_id, :ai_task_id, :task_type, :status, :completed_at, :sequence
  validates :status, inclusion: { in: %w[completed failed] }
end
