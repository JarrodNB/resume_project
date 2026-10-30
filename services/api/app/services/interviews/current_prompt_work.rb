# Owns queued help for the current interview prompt, from request through acceptance.
# The two feature adapters keep their payloads and validation; this module keeps locks,
# bounded explicit retries, preparation admission and queue recovery in one place.
module Interviews
  class CurrentPromptWork
    def self.for_task(task)
      return SessionFeedback.new if task.interview_session_feedback?
      return Clarification.new if task.interview_clarification?
      References.new if task.interview_references?
    end

    # Requests one prompt's logical work. Repeated requests reuse the saved attempt;
    # only an explicit retry replaces failed work, up to two total attempts.
    def request(interview:, message_id:, retry_failed: false)
      publish = nil
      result = interview.user.with_lock do
        interview.lock!
        message = interview.messages.find_by(id: message_id, kind: %w[opening follow_up])
        next failure("Question is no longer current") unless ClarificationPrompt.current?(interview, message)
        record = records(interview).find_or_initialize_by(message: message)
        next success(record) if reusable?(record)
        task = record.ai_task
        if task && !task.finished? && record.deadline && record.deadline <= Time.current
          fail_task(task, "#{label} timed out. Retry explicitly.")
        end
        next success(record) if task && (!task.failed? || !retry_failed)
        next failure("#{label} retry limit reached") if record.attempt_count >= 2
        admission = preparation_admission(interview)
        next admission unless admission.success?
        allowance = check_allowance(user: interview.user, existing_task: admission.value)
        next allowance unless allowance.success?
        record.save! unless record.persisted?
        task = interview.user.ai_tasks.create!(task_type: task_type, subject: interview,
          hourly_admission_task: admission.value, input: task_input(interview, record))
        record.update!(ai_task: task, attempt_count: record.attempt_count + 1, claimed_at: nil, deadline: 3.minutes.from_now)
        publish = task
        success(record)
      end
      if publish
        AiTasks::PublishTaskToQueueService.call(ai_task: publish)
      end
      result
    rescue *AiTasks::EnqueueAiTaskService::QUEUE_ERRORS
      if publish
        with_result_lock(ai_task: publish) do
          fail_task(publish, "Could not queue #{label.downcase}") unless publish.finished?
        end
      end
      failure("Could not queue #{label.downcase}. Please retry.")
    end

    # Grants one execution. References finalize obsolete work on redelivery;
    # clarification retains its historical claimed guard before availability checks.
    def claim(ai_task:)
      return success({ allowed: false }) unless ai_task.task_type == task_type
      record_found = false
      result = with_result_lock(ai_task: ai_task) do |interview, record|
        next success({ allowed: false }) unless record
        record_found = true
        next success({ allowed: false }) if ai_task.finished?
        next success({ allowed: false }) if claimed_guard_first? && record.claimed_at
        unless available?(interview, record, ai_task) && valid_claim_input?(interview, record, ai_task)
          fail_task(ai_task, "Question is no longer available")
          next success({ allowed: false })
        end
        next success({ allowed: false }) if record.claimed_at
        admission = preparation_admission(interview, task: ai_task)
        unless admission.success?
          fail_task(ai_task, admission.errors.join(", "))
          next success({ allowed: false })
        end
        allowance = check_allowance(user: ai_task.user, existing_task: ai_task)
        unless allowance.success?
          fail_task(ai_task, allowance.errors.join(", "))
          next success({ allowed: false })
        end
        record.update!(claimed_at: Time.current)
        success(claim_payload(interview, record))
      end
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: ai_task.id }, ai_task) if record_found && ai_task.failed?
      result
    end

    # The result consumer runs accounting, acceptance and task finalization inside
    # this transaction. Missing/deleted domain rows still allow late task usage.
    # Callers need no knowledge of interview associations or domain lock ordering.
    def with_result_lock(ai_task:)
      ai_task.user.with_lock do
        interview = ai_task.user.interview_sessions.find_by(id: ai_task.subject_id)
        interview&.lock!
        record = records(interview).find_by(ai_task_id: ai_task.id) if interview
        record&.lock!
        ai_task.with_lock { yield(interview, record) }
      end
    end

    # Accepts only a claimed, live result for the exact current task and prompt.
    # The result consumer must hold with_result_lock through task finalization.
    def apply(ai_task:, result:)
      interview = ai_task.user.interview_sessions.find_by(id: ai_task.subject_id)
      record = records(interview).find_by(ai_task_id: ai_task.id) if interview
      return failure("Question is no longer available") unless record && record.claimed_at && available?(interview, record, ai_task)
      attributes = result_attributes(ai_task, result)
      return attributes unless attributes.success?
      record.update!(attributes.value)
      success(record)
    end

    private

    def available?(interview, record, task)
      record.deadline > Time.current && ClarificationPrompt.current?(interview, record.message) &&
        task.input["question_text"] == record.message.content
    end

    def preparation_admission(interview, task: nil)
      preparation = interview.operations.preparation.first
      root = preparation&.ai_task
      if preparation || interview.frozen_context.present? || task&.hourly_admission_task_id
        valid = root && root.user_id == interview.user_id && root.subject == interview && root.interview_preparation? &&
          root.hourly_admission_task_id.nil? && root.input["operation_id"] == preparation.id
        valid &&= task.hourly_admission_task_id == root.id if task
        return failure("Interview admission is invalid") unless valid
      end
      success(root)
    end

    def fail_task(task, message)
      AiTasks::UpdateTaskService.call(task: task, attributes: { status: "failed", error_message: message, completed_at: Time.current })
    end

    def success(value)
      ServiceResult.new(success: true, value: value, errors: [])
    end

    def failure(errors)
      ServiceResult.new(success: false, value: nil, errors: Array(errors))
    end
  end
end
