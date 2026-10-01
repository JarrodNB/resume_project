# frozen_string_literal: true

# Description: aiTaskUpdated(id) subscription. Triggered by AiTasks::ApplyAiResultService.
# Subscribing returns the task's current state, so a result applied just before the client
# subscribed is not missed.
# Index:
#   - subscribe: checks ownership and returns the current task
#   - update: returns the task that was just updated
module Subscriptions
  class AiTaskUpdated < BaseSubscription
    argument :id, ID, required: true

    type Types::AiTaskType, null: false

    # Only the task's owner can subscribe; anyone else gets "Record not found".
    def subscribe(id:)
      current_user.ai_tasks.find(id)
    end

    # Pushes the updated task to the subscriber.
    def update(id:)
      object
    end
  end
end
