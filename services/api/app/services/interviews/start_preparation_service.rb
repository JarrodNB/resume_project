# Persists an authorized preparation command; Python reads current owned evidence once.
# Provider calls happen later through the private execution interface, never in this transaction.
module Interviews
  class StartPreparationService < ApplicationService
    def initialize(user:, career_focus: nil, setup: nil, job: nil)
      @user, @career_focus = user, career_focus.to_s.strip
      @job = job
      @setup = setup.nil? ? SetupConfiguration::DEFAULT : (setup.is_a?(Hash) ? SetupConfiguration::DEFAULT.merge(setup.stringify_keys) : setup)
    end

    # @return [ServiceResult<InterviewSession>] preparing session with source IDs and bounded choices
    def call
      return failure("Choose supported interview settings and 5, 8 or 12 questions") unless SetupConfiguration.valid?(@setup)
      return failure("Career focus must be at most 200 characters") if @career_focus.length > 200
      return failure("Record not found") if @job && @job.user_id != @user.id
      @user.with_lock do
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @user, interview: true)
        next allowance unless allowance.success?
        interview = @user.interview_sessions.create!(job: @job, status: "preparing", answer_cap: 3, execution_mode: "real",
          execution_config: ExecutionConfiguration::PRESETS.fetch("real"), setup_config: @setup, career_focus: @career_focus, preparation_kind: @job ? "saved_job" : "fictional_role", expires_at: 7.days.from_now)
        operation = interview.operations.create!(kind: "preparation")
        operation.update!(ai_task: @user.ai_tasks.create!(task_type: "interview_preparation", subject: interview,
          input: { operation_id: operation.id }))
        ScheduleOperationService.call(operation: operation)
        success(interview)
      end
    rescue ActiveRecord::RecordNotFound, ActiveRecord::InvalidForeignKey
      failure("Record not found")
    end
  end
end
