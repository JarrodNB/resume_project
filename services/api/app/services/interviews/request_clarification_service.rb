# Queues a small question-only task and reuses one explanation per prompt.
# Owner/interview locks serialize clicks; explicit retry is limited to two total tasks.
module Interviews
  class RequestClarificationService < ApplicationService
    def initialize(interview:, message_id:, retry_failed: false)
      @interview, @message_id, @retry_failed = interview, message_id, retry_failed
    end

    def call
      result = @interview.user.with_lock do
        @interview.lock!
        message = @interview.messages.find_by(id: @message_id, kind: %w[opening follow_up])
        next failure("Question is no longer current") unless ClarificationPrompt.current?(@interview, message)
        clarification = @interview.clarifications.find_or_initialize_by(message: message)
        next success(clarification) if clarification.explanation.present?
        task = clarification.ai_task
        if task && !task.finished? && clarification.deadline && clarification.deadline <= Time.current
          task.update!(status: "failed", error_message: "Clarification timed out. Retry explicitly.", completed_at: Time.current)
        end
        next success(clarification) if task && (!task.failed? || !@retry_failed)
        next failure("Clarification retry limit reached") if clarification.attempt_count >= 2
        preparation = @interview.operations.preparation.first
        root = preparation&.ai_task
        if preparation || @interview.frozen_context.present?
          next failure("Interview admission is invalid") unless root && root.user_id == @interview.user_id && root.subject == @interview &&
            root.interview_preparation? && root.hourly_admission_task_id.nil? && root.input["operation_id"] == preparation.id
        end
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @interview.user, existing_task: root, interview: true)
        next allowance unless allowance.success?
        clarification.save! unless clarification.persisted?
        task = @interview.user.ai_tasks.create!(task_type: "interview_clarification", subject: @interview,
          hourly_admission_task: root, input: { clarification_id: clarification.id, question_text: message.content })
        clarification.update!(ai_task: task, attempt_count: clarification.attempt_count + 1, claimed_at: nil, deadline: 3.minutes.from_now)
        @publish = task
        success(clarification)
      end
      if @publish
        Shoryuken::Client.queues(AI_TASKS_QUEUE_NAME).send_message(message_body: {
          ai_task_id: @publish.id, user_id: @publish.user_id, task_type: @publish.task_type, input: @publish.input }.to_json)
      end
      result
    rescue *AiTasks::EnqueueAiTaskService::QUEUE_ERRORS
      if @publish
        @interview.user.with_lock do
          @interview.lock!
          @interview.clarifications.find_by(ai_task_id: @publish.id)&.lock!
          @publish.with_lock do
            @publish.update!(status: "failed", error_message: "Could not queue clarification", completed_at: Time.current) unless @publish.finished?
          end
        end
      end
      failure("Could not queue clarification. Please retry.")
    end
  end
end
