# Grants one queued references execution without giving the AI database write access.
# Lost claims expire; only an explicit bounded request can replace their logical attempt.
# Terminal task changes record owner-visible outcomes in the same transaction.
module Interviews
  class ClaimReferencesService < ApplicationService
    def initialize(ai_task:)
      @task = ai_task
    end

    def call
      return success({ allowed: false }) unless @task.interview_references? && ReferencesPolicy.enabled?
      interview = @task.user.interview_sessions.find_by(id: @task.subject_id)
      return success({ allowed: false }) unless interview
      result = @task.user.with_lock do
        interview.lock!
        references_record = interview.career_references.find_by(ai_task_id: @task.id)
        next success({ allowed: false }) unless references_record
        references_record.lock!
        @task.lock!
        next success({ allowed: false }) if @task.finished? || references_record.claimed_at
        unless references_record.deadline > Time.current && ClarificationPrompt.current?(interview, references_record.message) &&
            @task.input["question_text"] == references_record.message.content &&
            (@task.input["query_text"] || @task.input["question_text"]) == ReferenceQuery.for(interview, references_record.message)
          AiTasks::UpdateTaskService.call(task: @task, attributes: { status: "failed", error_message: "Question is no longer available", completed_at: Time.current })
          next success({ allowed: false })
        end
        preparation = interview.operations.preparation.first
        root = preparation&.ai_task
        valid_root = root && root.user_id == interview.user_id && root.subject == interview && root.interview_preparation? &&
          root.hourly_admission_task_id.nil? && root.input["operation_id"] == preparation.id && @task.hourly_admission_task_id == root.id
        if (preparation || interview.frozen_context.present? || @task.hourly_admission_task_id) && !valid_root
          AiTasks::UpdateTaskService.call(task: @task, attributes: { status: "failed", error_message: "Interview admission is invalid", completed_at: Time.current })
          next success({ allowed: false })
        end
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @task.user, existing_task: @task, interview: true, reference_work: true)
        unless allowance.success?
          AiTasks::UpdateTaskService.call(task: @task, attributes: { status: "failed", error_message: allowance.errors.join(", "), completed_at: Time.current })
          next success({ allowed: false })
        end
        references_record.update!(claimed_at: Time.current)
        success({ allowed: true, question_text: references_record.message.content,
          query_text: ReferenceQuery.for(interview, references_record.message),
          user_id: interview.user_id, reference_id: references_record.id })
      end
      ApiSchema.subscriptions.trigger(:ai_task_updated, { id: @task.id }, @task) if @task.failed?
      result
    end
  end
end
