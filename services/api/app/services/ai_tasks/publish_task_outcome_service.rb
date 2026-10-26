# Delivers a committed task outcome to its owner's app. Transport failure must not
# change accepted work; the saved occurrence remains available for reconnect recovery.
module AiTasks
  class PublishTaskOutcomeService < ApplicationService
    def initialize(outcome:)
      @outcome = outcome
    end

    def call
      ApiSchema.subscriptions.trigger(:ai_task_finished, {},
        { cursor: @outcome.sequence.to_s, outcome: @outcome }, scope: @outcome.user_id)
      success(@outcome)
    rescue StandardError => error
      Rails.logger.warn("Task outcome delivery failed: #{error.class}")
      failure("Task outcome delivery unavailable")
    end
  end
end
