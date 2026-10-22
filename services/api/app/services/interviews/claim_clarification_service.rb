# Grants one queued clarification execution without giving the AI database write access.
# Lost claims expire; only an explicit bounded request can replace their logical attempt.
module Interviews
  class ClaimClarificationService < ApplicationService
    def initialize(ai_task:)
      @task = ai_task
    end

    def call
      return success({ allowed: false }) unless @task.interview_clarification?
      interview = @task.user.interview_sessions.find_by(id: @task.subject_id)
      return success({ allowed: false }) unless interview
      result = @task.user.with_lock do
        interview.lock!
        clarification = interview.clarifications.find_by(ai_task_id: @task.id)
        next success({ allowed: false }) unless clarification
        clarification.lock!
        @task.lock!
        next success({ allowed: false }) if @task.finished? || clarification.claimed_at
        unless clarification.deadline > Time.current && ClarificationPrompt.current?(interview, clarification.message) &&
            @task.input["question_text"] == clarification.message.content
          @task.update!(status: "failed", error_message: "Question is no longer available", completed_at: Time.current)
          next success({ allowed: false })
        end
        preparation = interview.operations.preparation.first
        root = preparation&.ai_task
        valid_root = root && root.user_id == interview.user_id && root.subject == interview && root.interview_preparation? &&
          root.hourly_admission_task_id.nil? && root.input["operation_id"] == preparation.id && @task.hourly_admission_task_id == root.id
        if (preparation || interview.frozen_context.present? || @task.hourly_admission_task_id) && !valid_root
          @task.update!(status: "failed", error_message: "Interview admission is invalid", completed_at: Time.current)
          next success({ allowed: false })
        end
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @task.user, existing_task: @task, interview: true)
        unless allowance.success?
          @task.update!(status: "failed", error_message: allowance.errors.join(", "), completed_at: Time.current)
          next success({ allowed: false })
        end
        clarification.update!(claimed_at: Time.current)
        success({ allowed: true, question_text: clarification.message.content })
      end
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: @task.id }, @task) if @task.failed?
      result
    end
  end
end
