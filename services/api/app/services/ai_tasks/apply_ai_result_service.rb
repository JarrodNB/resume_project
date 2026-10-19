# Description: Applies one ai_results message to its AiTask and notifies subscribers.
# Idempotent: finished tasks keep their outcome; independently deduplicated usage can arrive late.
# The row lock stops two copies of the same report from both adding token usage and cost.
# Costs stored on the task count toward the user's monthly AI budget. A completed scrape_job
# or parse_job_posting also saves its Job in the same locked transaction. All results acquire
# the owner lock before the task lock, matching resume saves and interview operations.
# Successful screening stamps commit first, one source at a time, independently of outcomes.
# Index:
#   - call: updates the task from the message; returns the task, or errors for a bad message
module AiTasks
  class ApplyAiResultService < ApplicationService
    RESULT_STATUSES = %w[completed needs_user_input failed usage].freeze
    USAGE_COLUMNS = %w[input_tokens cached_input_tokens output_tokens cost_microdollars].freeze

    # @param message [Hash] parsed result message with string keys
    def initialize(message:)
      @message = message
    end

    # Validates and applies the message, notifying subscribers only when the outcome changes.
    # Call without an enclosing transaction: each screening UPDATE must release its source
    # lock before the next stamp and before the owner/task outcome transaction begins.
    def call
      status = @message["status"]
      return failure([ "Unknown result status: #{status.inspect}" ]) unless RESULT_STATUSES.include?(status)
      if status == "usage" && @message["attempt_id"].blank?
        return failure([ "Usage reports require an attempt_id" ])
      end

      ai_task = AiTask.find_by(id: @message["ai_task_id"])
      return failure([ "AI task not found: #{@message['ai_task_id'].inspect}" ]) unless ai_task

      RecordScreening::ApplySuccessesService.call(ai_task: ai_task, reports: @message["screening_successes"])
      applied = with_result_lock(ai_task) do
        if @message["attempt_id"].present?
          RecordAttemptUsageService.call(ai_task: ai_task, message: @message)
        end
        next false if status == "usage" || ai_task.finished?

        attributes = attributes_for(status)
        attributes.merge!(usage_attributes) unless @message["attempt_id"].present?
        attributes.merge!(domain_record_attributes(ai_task)) if status == "completed"
        ai_task.update!(attributes)
      end
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: ai_task.id }, ai_task) if applied
      success(ai_task)
    end

    private

    # Use the same owner/task order as enqueue, resume saves, imports and interview
    # operations. Screening has already committed independently before these locks.
    def with_result_lock(ai_task, &block)
      ai_task.user.with_lock { ai_task.with_lock(&block) }
    end

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

    # Saves completed job/interview results in the task transaction; invalid domain output fails the task.
    def domain_record_attributes(ai_task)
      if ai_task.generate_interview_questions? || ai_task.regenerate_interview_question? || ai_task.review_interview_answer?
        service = ai_task.review_interview_answer? ? InterviewPrep::ApplyFeedbackService : InterviewPrep::ApplyQuestionsService
        result = service.call(ai_task: ai_task, result: @message["result"])
        return {} if result.success?

        return { status: "failed", result: nil, error_message: result.errors.join(", ") }
      end
      return {} unless ai_task.scrape_job? || ai_task.parse_job_posting?

      scraped_job = @message["result"]["scraped_job"] if @message["result"].is_a?(Hash)
      result = save_job(ai_task, scraped_job)
      return { subject: result.value } if result.success?

      { status: "failed", error_message: "We couldn't save this job: #{result.errors.join(', ')}" }
    end

    # Turns the worker's posting into a Job. A paste has no canonical link of its own.
    def save_job(ai_task, scraped_job)
      if ai_task.parse_job_posting?
        Jobs::CreateJobFromPastedPostingService.call(ai_task: ai_task, scraped_job: scraped_job)
      else
        Jobs::CreateJobFromScrapedPostingService.call(ai_task: ai_task, scraped_job: scraped_job)
      end
    end

    # Messages without execution identity assign totals; finished-task checks above keep
    # duplicate outcomes from charging twice. Current workers use per-attempt accounting.
    def usage_attributes
      entries = Array(@message["usage"])
      USAGE_COLUMNS.index_with { |column| entries.sum { |entry| entry[column].to_i } }
    end
  end
end
