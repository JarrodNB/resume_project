# Reuses one persisted preparation admission for this interview's own bounded stages.
# Child tasks use the separate interview spend/concurrency allowance; only hourly admission is shared.
module Interviews
  class CheckOperationAllowanceService < ApplicationService
    def initialize(operation:, create_task: false)
      @operation, @create_task = operation, create_task
    end

    # Call under the owner/interview/operation locks. No provider calls or reservations occur.
    # @return [ServiceResult] ordinary monthly/in-flight admission or a clear invalid-link error
    def call
      interview = @operation.interview_session
      return failure("Interview is no longer available") if interview.expired? || interview.abandoned? || interview.expires_at <= Time.current
      return failure("Preparation is no longer active") if @operation.preparation? && !interview.preparing?
      return failure("Interview is not active") if (@operation.turn? || @operation.transcription?) && !interview.active?
      return failure("Interview speech is not available") if @operation.speech? && !interview.active? && !interview.completed?
      preparation = interview.operations.preparation.first
      root = preparation&.ai_task
      if root
        valid_root = root.persisted? && root.user_id == interview.user_id && root.subject == interview &&
          root.task_type == "interview_preparation" && root.hourly_admission_task_id.nil? &&
          root.input["operation_id"] == preparation.id
        return failure("Interview admission is invalid") unless valid_root
        if !@operation.preparation?
          task = @operation.ai_task
          if task.nil? && @create_task
            task = interview.user.ai_tasks.create!(task_type: "interview_#{@operation.kind}", subject: interview,
              hourly_admission_task: root, input: { operation_id: @operation.id })
            @operation.update!(ai_task: task)
          end
          return failure("Interview admission is invalid") unless task && task.user_id == interview.user_id &&
            task.subject == interview && task.task_type == "interview_#{@operation.kind}" &&
            task.hourly_admission_task_id == root.id && task.input["operation_id"] == @operation.id
        end
      elsif preparation || interview.frozen_context.present? || @operation.ai_task&.hourly_admission_task_id
        return failure("Interview admission is invalid")
      end
      AiUsage::CheckAiTaskAllowanceService.call(user: interview.user, existing_task: @operation.ai_task, interview: true)
    end
  end
end
