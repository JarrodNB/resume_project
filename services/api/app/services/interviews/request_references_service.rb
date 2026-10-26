# Queues retrieval and reuses saved career references for each current prompt.
# Owner/interview locks serialize clicks; explicit retry is limited to two total tasks.
# Terminal task changes record owner-visible outcomes in the same transaction.
module Interviews
  class RequestReferencesService < ApplicationService
    def initialize(interview:, message_id:, retry_failed: false)
      @interview, @message_id, @retry_failed = interview, message_id, retry_failed
    end

    def call
      return failure("Career references are unavailable") unless ReferencesPolicy.enabled?
      result = @interview.user.with_lock do
        @interview.lock!
        message = @interview.messages.find_by(id: @message_id, kind: %w[opening follow_up])
        next failure("Question is no longer current") unless ClarificationPrompt.current?(@interview, message)
        references_record = @interview.career_references.find_or_initialize_by(message: message)
        next success(references_record) if references_record.references.any? || references_record.ai_task&.completed?
        task = references_record.ai_task
        if task && !task.finished? && references_record.deadline && references_record.deadline <= Time.current
          AiTasks::UpdateTaskService.call(task: task, attributes: { status: "failed", error_message: "References timed out. Retry explicitly.", completed_at: Time.current })
        end
        next success(references_record) if task && (!task.failed? || !@retry_failed)
        next failure("References retry limit reached") if references_record.attempt_count >= 2
        preparation = @interview.operations.preparation.first
        root = preparation&.ai_task
        if preparation || @interview.frozen_context.present?
          next failure("Interview admission is invalid") unless root && root.user_id == @interview.user_id && root.subject == @interview &&
            root.interview_preparation? && root.hourly_admission_task_id.nil? && root.input["operation_id"] == preparation.id
        end
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @interview.user, existing_task: root, interview: true)
        next allowance unless allowance.success?
        references_record.save! unless references_record.persisted?
        query_input = message.follow_up? ? { query_text: ReferenceQuery.for(@interview, message) } : {}
        task = @interview.user.ai_tasks.create!(task_type: "interview_references", subject: @interview,
          hourly_admission_task: root, input: { reference_id: references_record.id, question_text: message.content }.merge(query_input))
        references_record.update!(ai_task: task, attempt_count: references_record.attempt_count + 1, claimed_at: nil, deadline: 3.minutes.from_now)
        @publish = task
        success(references_record)
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
          @interview.career_references.find_by(ai_task_id: @publish.id)&.lock!
          @publish.with_lock do
            AiTasks::UpdateTaskService.call(task: @publish, attributes: { status: "failed", error_message: "Could not queue references", completed_at: Time.current }) unless @publish.finished?
          end
        end
      end
      failure("Could not queue references. Please retry.")
    end
  end
end
