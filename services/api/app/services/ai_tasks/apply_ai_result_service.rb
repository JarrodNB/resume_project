# Description: Applies one ai_results message to its AiTask and notifies subscribers.
# Idempotent: results for a finished (completed/failed) task are ignored, and the row lock
# stops two copies of the same message from both applying. The message's token usage and cost
# are stored on the task (they count toward the user's monthly AI budget). A completed scrape_job
# also saves its Job (Jobs::CreateJobFromScrapedPostingService) in the same locked transaction.
# Index:
#   - call: updates the task from the message; returns the task, or errors for a bad message
module AiTasks
  class ApplyAiResultService < ApplicationService
    RESULT_STATUSES = %w[completed needs_user_input failed].freeze
    USAGE_COLUMNS = %w[input_tokens cached_input_tokens output_tokens cost_microdollars].freeze

    # @param message [Hash] parsed result message with string keys
    def initialize(message:)
      @message = message
    end

    # Validates the message, applies it under a row lock, and triggers aiTaskUpdated if it changed.
    def call
      status = @message["status"]
      return failure([ "Unknown result status: #{status.inspect}" ]) unless RESULT_STATUSES.include?(status)

      ai_task = AiTask.find_by(id: @message["ai_task_id"])
      return failure([ "AI task not found: #{@message['ai_task_id'].inspect}" ]) unless ai_task

      applied = ai_task.with_lock do
        next false if ai_task.finished?

        attributes = attributes_for(status).merge(usage_attributes)
        attributes.merge!(domain_record_attributes(ai_task)) if status == "completed"
        ai_task.update!(attributes)
      end
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: ai_task.id }, ai_task) if applied
      success(ai_task)
    end

    private

    # Maps a result message to the AiTask attributes it sets.
    def attributes_for(status)
      case status
      when "completed"
        { status:, result: @message["result"], pending_questions: [], completed_at: Time.current }
      when "needs_user_input"
        {
          status:,
          pending_questions: @message["pending_questions"] || [],
          message_history: @message["message_history"] || []
        }
      when "failed"
        { status:, error_message: @message["error_message"], completed_at: Time.current }
      end
    end

    # Saves the domain record a completed task produces without user review (only scrape_job so
    # far) and links it as the task's subject. If it can't be saved, the task fails instead.
    def domain_record_attributes(ai_task)
      return {} unless ai_task.scrape_job?

      scraped_job = @message["result"]["scraped_job"] if @message["result"].is_a?(Hash)
      result = Jobs::CreateJobFromScrapedPostingService.call(ai_task: ai_task, scraped_job: scraped_job)
      return { subject: result.value } if result.success?

      { status: "failed", error_message: "We couldn't save this job: #{result.errors.join(', ')}" }
    end

    # Sums the message's per-model usage entries into the task's token and cost columns. They
    # are assigned, not added, so a redelivered message can't count twice.
    def usage_attributes
      entries = Array(@message["usage"])
      USAGE_COLUMNS.index_with { |column| entries.sum { |entry| entry[column].to_i } }
    end
  end
end
