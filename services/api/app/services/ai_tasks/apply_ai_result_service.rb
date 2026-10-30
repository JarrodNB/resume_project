# Description: Applies one ai_results message to its AiTask and notifies subscribers.
# Idempotent: finished tasks keep their outcome; independently deduplicated usage can arrive late.
# The row lock stops two copies of the same report from both adding token usage and cost.
# Costs stored on the task count toward the user's monthly AI budget. A completed scrape_job
# or parse_job_posting also saves its Job in the same locked transaction. Gap-analysis,
# tailoring and interview results acquire the owner lock before task/job/answer/library locks and persist
# in that transaction.
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

    # Validates the message, applies it under a row lock, and triggers aiTaskUpdated if it changed.
    def call
      status = @message["status"]
      return failure([ "Unknown result status: #{status.inspect}" ]) unless RESULT_STATUSES.include?(status)
      if status == "usage" && @message["attempt_id"].blank?
        return failure([ "Usage reports require an attempt_id" ])
      end

      ai_task = AiTask.find_by(id: @message["ai_task_id"])
      return failure([ "AI task not found: #{@message['ai_task_id'].inspect}" ]) unless ai_task

      applied = with_result_lock(ai_task) do
        usage_recorded = false
        if @message["attempt_id"].present?
          usage_recorded = RecordAttemptUsageService.call(ai_task: ai_task, message: @message).value
        end
        # Late usage still changes the task's cost totals, so subscribers need to hear about it.
        next usage_recorded if status == "usage" || ai_task.finished? || ((ai_task.improve_library_entry? || ai_task.elicit_job_preferences?) && !ai_task.queued?)

        InterviewPrep::RecordScreeningService.call(ai_task: ai_task, reports: @message["interview_question_screening"])
        Jobs::RecordScreeningService.call(ai_task: ai_task, reports: @message["job_screening"])
        GapResponses::RecordScreeningService.call(ai_task: ai_task, reports: @message["gap_response_screening"])
        record_screening(ai_task)

        if ai_task.generate_summary?
          # Summary snapshots keep screening execution-local; never approve changed live facts.
        elsif ai_task.review_library_section? || ai_task.improve_library_entry?
          CareerLibrary::ApplyReviewService.record_screening(ai_task: ai_task, reports: @message["library_screening"])
        else
          CareerLibrary::RecordScreeningService.call(user: ai_task.user, reports: @message["library_screening"])
        end

        attributes = attributes_for(status)
        attributes.merge!(usage_attributes) unless @message["attempt_id"].present?
        if ai_task.elicit_job_preferences? && %w[completed needs_user_input].include?(status)
          result = JobPreferences::ApplyConversationService.call(ai_task: ai_task, message: @message)
          attributes.merge!(result.success? ? result.value : { status: "failed", result: nil, message_history: [], pending_questions: [], error_message: result.errors.join(", "), completed_at: Time.current })
        elsif ai_task.improve_library_entry? && %w[completed needs_user_input].include?(status)
          result = CareerLibrary::ApplyEditService.call(ai_task: ai_task, message: @message)
          attributes.merge!(result.success? ? result.value : { status: "failed", result: nil, message_history: [], pending_questions: [], error_message: result.errors.join(", "), completed_at: Time.current })
        elsif status == "completed"
          attributes.merge!(domain_record_attributes(ai_task))
        end
        UpdateTaskService.call(task: ai_task, attributes: attributes)
      end
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: ai_task.id }, ai_task) if applied
      success(ai_task)
    end

    private

    # Saves the unified `record_screening` receipts. Library receipts follow the same rules
    # as the older `library_screening` list: summary generation keeps them execution-local,
    # and review/edit tasks must also match the frozen library snapshot.
    def record_screening(ai_task)
      receipts = @message["record_screening"]
      return unless receipts.is_a?(Array)

      library, others = receipts.partition do |receipt|
        receipt.is_a?(Hash) && Screening::RecordApprovalsService::LIBRARY_TYPES.include?(receipt["record_type"])
      end
      if ai_task.generate_summary?
        receipts = others
      elsif ai_task.review_library_section? || ai_task.improve_library_entry?
        receipts = others
        reports = library.filter_map do |receipt|
          next unless receipt["fingerprints"].is_a?(Hash)

          receipt.slice("record_type", "record_id", "fingerprints").merge("fields" => receipt["fingerprints"].keys)
        end
        CareerLibrary::ApplyReviewService.record_screening(ai_task: ai_task, reports: reports)
      end
      Screening::RecordApprovalsService.call(user: ai_task.user, reports: receipts, ai_task: ai_task)
    end

    # All result writes acquire the owner first. This preserves domain lock ordering and
    # serializes the outcome cursor through commit for reconnect recovery.
    def with_result_lock(ai_task, &block)
      if (prompt_work = Interviews::CurrentPromptWork.for_task(ai_task))
        prompt_work.with_result_lock(ai_task: ai_task, &block)
      else
        ai_task.user.with_lock { ai_task.with_lock(&block) }
      end
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
      if ai_task.generate_summary?
        result = SummaryGeneration::ValidateResultService.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : failed_attributes(result.errors)
      end
      if ai_task.check_job_preferences?
        result = JobPreferences::ValidateCheckResultService.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : failed_attributes(result.errors)
      end
      if ai_task.rerank_job_listings?
        result = JobBoard::ValidateRerankingResultService.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : failed_attributes(result.errors)
      end
      if ai_task.generate_study_guide?
        result = StudyGuides::ValidateResultService.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : failed_attributes(result.errors)
      end
      if ai_task.review_library_section?
        result = CareerLibrary::ApplyReviewService.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : failed_attributes(result.errors)
      end
      if (prompt_work = Interviews::CurrentPromptWork.for_task(ai_task))
        result = prompt_work.apply(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : failed_attributes(result.errors)
      end
      if ai_task.generate_interview_questions? || ai_task.regenerate_interview_question? || ai_task.review_interview_answer?
        service = ai_task.review_interview_answer? ? InterviewPrep::ApplyFeedbackService : InterviewPrep::ApplyQuestionsService
        result = service.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : failed_attributes(result.errors)
      end
      return {} unless ai_task.scrape_job? || ai_task.parse_job_posting?

      scraped_job = @message["result"]["scraped_job"] if @message["result"].is_a?(Hash)
      result = Jobs::CreateJobFromPostingService.call(ai_task: ai_task, scraped_job: scraped_job)
      return { subject: result.value } if result.success?

      failed_attributes([ "We couldn't save this job: #{result.errors.join(', ')}" ])
    end

    # Attributes for a result that arrived as "completed" but could not be saved: drop the
    # unusable result so the task reads as a plain failure.
    def failed_attributes(errors)
      { status: "failed", result: nil, pending_questions: [], error_message: errors.join(", ") }
    end

    # Messages without execution identity assign totals; finished-task checks above keep
    # duplicate outcomes from charging twice. Current workers use per-attempt accounting.
    def usage_attributes
      entries = Array(@message["usage"])
      USAGE_COLUMNS.index_with { |column| entries.sum { |entry| entry[column].to_i } }
    end
  end
end
