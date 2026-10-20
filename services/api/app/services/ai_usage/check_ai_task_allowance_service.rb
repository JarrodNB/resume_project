# Description: Decides whether a user may start another AI task: monthly budget left, under the
# hourly task limit, and under the in-flight task limit. A task's cost is only known after it
# finishes, so the in-flight limit is what bounds overshooting the budget.
# Index:
#   - call: succeeds when the user may start a task; fails with a user-facing reason otherwise
module AiUsage
  class CheckAiTaskAllowanceService < ApplicationService
    # Queued tasks older than this are treated as stuck, so they don't block the user forever.
    IN_FLIGHT_WINDOW = 15.minutes

    # An already-owned logical HTTP task rechecks spend/concurrency without counting
    # itself as another hourly task or blocking its own retry as in-flight work.
    def initialize(user:, existing_task: nil)
      @user = user
      @existing_task = existing_task
    end

    # Checks each limit in turn and fails with the first one that's reached.
    def call
      monthly_usage = SummarizeMonthlyAiUsageService.call(user: @user).value
      return failure([ monthly_limit_message(monthly_usage) ]) if monthly_usage.exhausted?
      return failure([ "You've started too many AI tasks in the last hour. Please try again later." ]) if !@existing_task && hourly_limit_reached?
      return failure([ "You already have AI tasks running. Wait for them to finish, then try again." ]) if in_flight_limit_reached?

      success
    end

    private

    # Returns true when the user started as many tasks as allowed in the last hour.
    def hourly_limit_reached?
      limit = @user.ai_tasks_per_hour_limit || DEFAULT_AI_TASKS_PER_HOUR
      @user.ai_tasks.where(created_at: 1.hour.ago..).count >= limit
    end

    # Returns true when the user has as many recently queued tasks as allowed. Tasks waiting on
    # the user's answer (needs_user_input) aren't running, so they don't count.
    def in_flight_limit_reached?
      limit = @user.max_in_flight_ai_tasks || DEFAULT_MAX_IN_FLIGHT_AI_TASKS
      tasks = @user.ai_tasks.queued.where(created_at: IN_FLIGHT_WINDOW.ago..)
      tasks = tasks.where.not(id: @existing_task.id) if @existing_task
      tasks.count >= limit
    end

    # Builds the message shown when the monthly budget is used up.
    def monthly_limit_message(monthly_usage)
      "You've reached this month's AI usage limit. It resets on #{monthly_usage.resets_at.strftime('%B %-d')}."
    end
  end
end
