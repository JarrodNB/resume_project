# Description: Applies one ai_results message to its AiTask and notifies subscribers.
# Idempotent: finished tasks keep their outcome; independently deduplicated usage can arrive late.
# The row lock stops two copies of the same report from both adding token usage and cost.
# Costs stored on the task count toward the user's monthly AI budget. A completed scrape_job
# or parse_job_posting also saves its Job in the same locked transaction. Interview question
# results acquire the owner lock before the task lock and persist in that transaction.
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
        if @message["attempt_id"].present?
          RecordAttemptUsageService.call(ai_task: ai_task, message: @message)
        end
        next false if status == "usage" || ai_task.finished? || stale_generation?(ai_task)

        attributes = if (ai_task.check_resume_content? || ai_task.check_resume_pdf?) && status == "needs_user_input"
          { status: "failed", result: nil, error_message: "Invalid check response. Please retry.", completed_at: Time.current }
        else
          attributes_for(status)
        end
        attributes.merge!(usage_attributes(ai_task)) unless @message["attempt_id"].present?
        attributes.merge!(tailor_input_attributes(ai_task)) if ai_task.tailor_resume?
        attributes.merge!(domain_record_attributes(ai_task)) if status == "completed"
        if ai_task.check_resume_content? && attributes[:status] == "failed"
          ai_task.user.ats_check_runs.find_by(ai_task_id: ai_task.id)&.update!(status: "failed", error_message: attributes[:error_message])
        end
        if ai_task.check_resume_pdf? && attributes[:status] == "failed"
          run = ai_task.user.ats_check_runs.find_by(id: ai_task.input["run_id"])
          run&.with_lock do
            run.update!(pdf_result: run.pdf_result.merge("status" => "failed", "score" => nil, "reason" => attributes[:error_message])) if run.pdf_result["task_id"] == ai_task.id
          end
        end
        ai_task.update!(attributes)
      end
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: ai_task.id }, ai_task) if applied
      if applied && (ai_task.check_resume_content? || ai_task.check_resume_pdf?) && ai_task.subject.is_a?(Resume)
        AtsChecks::NotifyReportService.call(resume: ai_task.subject)
      end
      if ai_task.check_resume_pdf? && ai_task.finished? && ai_task.source_file.attached?
        ai_task.source_file.purge
      end
      success(ai_task)
    end

    private

    # Interview writes share the owner lock with enqueue/save/delete; acquire it before the task.
    def with_result_lock(ai_task, &block)
      if ai_task.check_resume_content? || ai_task.check_resume_pdf? || ai_task.generate_interview_questions? || ai_task.regenerate_interview_question? || ai_task.review_interview_answer?
        ai_task.user.with_lock { ai_task.with_lock(&block) }
      else
        ai_task.with_lock(&block)
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
      if ai_task.check_resume_pdf?
        result = AtsChecks::ApplyPdfResultService.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : { status: "failed", result: nil, error_message: result.errors.join(", ") }
      end
      if ai_task.check_resume_content?
        result = AtsChecks::ApplyContentResultService.call(ai_task: ai_task, result: @message["result"])
        return result.success? ? {} : { status: "failed", result: nil, error_message: result.errors.join(", ") }
      end
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

    # True when this result is from an earlier step of a requeued task. Other task types omit
    # generation, and those results are applied as before.
    def stale_generation?(ai_task)
      generation = @message["generation"]
      return false if generation.nil?

      generation.to_i != ai_task.generation
    end

    # Copies the sections approved so far onto the task input and clears the submission that
    # this step already handled, so a reload shows the same draft. A failure that carries no
    # draft leaves the submission in place.
    def tailor_input_attributes(ai_task)
      approved = approved_sections_from_message
      return {} if @message["status"] == "failed" && approved.nil?

      input = ai_task.input.deep_dup
      input["approved_sections"] = approved unless approved.nil?
      input["pending_section"] = nil
      { input: input }
    end

    # Approved sections travel on the pause question, or as the finished draft's sections.
    def approved_sections_from_message
      question = Array(@message["pending_questions"]).first
      return question["approved_sections"] if question.is_a?(Hash) && question.key?("approved_sections")

      sections = @message["result"]["sections"] if @message["result"].is_a?(Hash)
      sections
    end

    # Sums the message's per-model usage. A task that is requeued per section adds each step's
    # cost once (`usage_generation`); every other task assigns, so a redelivery can't count twice.
    def usage_attributes(ai_task)
      entries = Array(@message["usage"])
      incoming = USAGE_COLUMNS.index_with { |column| entries.sum { |entry| entry[column].to_i } }
      generation = @message["generation"]
      return incoming if generation.nil?
      return {} if generation.to_i == ai_task.usage_generation

      added = USAGE_COLUMNS.index_with { |column| ai_task.public_send(column) + incoming[column] }
      added.merge("usage_generation" => generation.to_i)
    end
  end
end
