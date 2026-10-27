# Checks monthly spend, hourly starts and in-flight work within one independent allowance.
# Spoken interview work never consumes general AI allowances, or the other way around.
# Optional references have their own bounded in-flight pool so they never block answering.
# Development-only unmetered interview testing skips spend/start gates; concurrency still bounds work.
# Index:
#   - call: succeeds when the user may start a task; fails with a user-facing reason otherwise
module AiUsage
  class CheckAiTaskAllowanceService < ApplicationService
    # Queued tasks older than this are treated as stuck, so they don't block the user forever.
    IN_FLIGHT_WINDOW = 15.minutes

    # An already-owned logical HTTP task rechecks spend/concurrency without counting
    # itself as another hourly task or blocking its own retry as in-flight work.
    def initialize(user:, existing_task: nil, interview: false, reference_work: false)
      @user, @existing_task, @interview = user, existing_task, interview
      @reference_work = interview && reference_work
      @tasks = interview ? user.ai_tasks.spoken_interview : user.ai_tasks.general_ai
    end

    # Checks each limit in turn and fails with the first one that's reached.
    def call
      unless @interview && Interviews::LocalTesting.unmetered?
        monthly_usage = SummarizeMonthlyAiUsageService.call(user: @user, interview: @interview).value
        return failure([ monthly_limit_message(monthly_usage) ]) if monthly_usage.exhausted?
        return failure([ "You've started too many #{@interview ? 'interview sessions' : 'AI tasks'} in the last hour. Please try again later." ]) if !@existing_task && hourly_limit_reached?
      end
      return failure([ "You already have #{@interview ? (@reference_work ? 'career references' : 'interview operations') : 'AI tasks'} running. Wait for them to finish, then try again." ]) if in_flight_limit_reached?

      success
    end

    private

    # Prepared interview children share their root's hourly admission only; all other
    # tasks keep their existing count, including failures and finished work.
    def hourly_limit_reached?
      limit = @interview ? DEFAULT_INTERVIEW_SESSIONS_PER_HOUR : (@user.ai_tasks_per_hour_limit || DEFAULT_AI_TASKS_PER_HOUR)
      @tasks.hourly_admissions.where(created_at: 1.hour.ago..).count >= limit
    end

    # Returns true when the user has as many recently queued tasks as allowed. Tasks waiting on
    # the user's answer (needs_user_input) aren't running, so they don't count.
    def in_flight_limit_reached?
      limit = @interview ? DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS : (@user.max_in_flight_ai_tasks || DEFAULT_MAX_IN_FLIGHT_AI_TASKS)
      # Spend and hourly admission still use all spoken-interview tasks. Only resource
      # admission splits optional retrieval from operations required to continue an interview.
      pool = if @interview
        @reference_work ? @tasks.where(task_type: "interview_references") : @tasks.where.not(task_type: "interview_references")
      else
        @tasks
      end
      if @reference_work
        # Reference deadlines are shorter than the generic stuck-task window. Count
        # only each owned prompt's latest live attempt; an earlier prompt's dead
        # worker must not consume capacity while awaiting redelivery or manual retry.
        live_attempts = InterviewCareerReferences.where(interview_session_id: @user.interview_sessions.select(:id))
          .where("deadline > ?", Time.current).select(:ai_task_id)
        pool = pool.where(id: live_attempts)
      end
      tasks = pool.queued.where(created_at: IN_FLIGHT_WINDOW.ago..)
      tasks = tasks.where.not(id: @existing_task.id) if @existing_task
      tasks.count >= limit
    end

    # Builds the message shown when the monthly budget is used up.
    def monthly_limit_message(monthly_usage)
      "You've reached this month's #{@interview ? 'interview' : 'AI'} usage limit. It resets on #{monthly_usage.resets_at.strftime('%B %-d')}."
    end
  end
end
