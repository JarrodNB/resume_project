# Persists an authorized preparation command; Python reads current owned evidence once.
# Provider calls happen later through the private execution interface, never in this transaction.
module Interviews
  class StartPreparationService < ApplicationService
    # Live interviews always have exactly this many main questions; turn-based keeps 5, 8 or 12.
    LIVE_QUESTION_COUNT = 5

    def initialize(user:, career_focus: nil, setup: nil, job: nil, conversation_mode: "turn_based")
      @user, @career_focus, @conversation_mode = user, career_focus.to_s.strip, conversation_mode
      @job = job
      default = conversation_mode == "live" ? SetupConfiguration::DEFAULT.merge("question_count" => LIVE_QUESTION_COUNT) : SetupConfiguration::DEFAULT
      @setup = setup.nil? ? default : (setup.is_a?(Hash) ? SetupConfiguration::DEFAULT.merge(setup.stringify_keys) : setup)
    end

    # @param conversation_mode [String] "turn_based" or "live"; live allows only 5 questions (a live
    #   start with no setup gets 5), and needs enough of the hidden live budget left (LiveAllowance)
    # @return [ServiceResult<InterviewSession>] preparing session with source IDs and bounded choices
    def call
      return failure("Choose supported interview settings and 5, 8 or 12 questions") unless SetupConfiguration.valid?(@setup)
      return failure("Choose a turn-based or live interview") unless InterviewSession::CONVERSATION_MODES.include?(@conversation_mode)
      return failure("Live interviews use 5 questions") if @conversation_mode == "live" && @setup["question_count"] != LIVE_QUESTION_COUNT
      return failure("Career focus must be at most 200 characters") if @career_focus.length > 200
      return failure("Record not found") if @job && @job.user_id != @user.id
      @user.with_lock do
        allowance = AiUsage::CheckAiTaskAllowanceService.call(user: @user, interview: true)
        next allowance unless allowance.success?
        live_refusal = @conversation_mode == "live" && LiveAllowance.start_refusal(@user)
        next failure(live_refusal, code: :live_allowance_low) if live_refusal
        interview = @user.interview_sessions.create!(job: @job, status: "preparing", answer_cap: SetupConfiguration.answer_cap(@setup), execution_mode: "real",
          execution_config: ExecutionConfiguration::PRESETS.fetch("real"), setup_config: @setup, conversation_mode: @conversation_mode, career_focus: @career_focus, preparation_kind: @job ? "saved_job" : "fictional_role", expires_at: 7.days.from_now)
        operation = interview.operations.create!(kind: "preparation")
        operation.update!(ai_task: @user.ai_tasks.create!(counts_toward_trial_budget: AiUsage::SiteDailySpend.counts_user?(@user), task_type: "interview_preparation", subject: interview,
          input: { operation_id: operation.id }))
        AiExecutions::ScheduleOperationService.call(operation: operation)
        success(interview)
      end
    rescue ActiveRecord::RecordNotFound, ActiveRecord::InvalidForeignKey
      failure("Record not found")
    end
  end
end
