# Description: Global default limits on each user's AI usage. A user's non-null override column
# (monthly_ai_budget_microdollars, ai_tasks_per_hour_limit, max_in_flight_ai_tasks) wins.
# Enforced by AiUsage::CheckAiTaskAllowanceService before a task is queued.
# Index:
#   - DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS: estimated LLM spend allowed per calendar month (UTC)
#   - DEFAULT_AI_TASKS_PER_HOUR: tasks a user may start in any rolling hour
#   - DEFAULT_MAX_IN_FLIGHT_AI_TASKS: queued tasks a user may have at once
DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS = (BigDecimal(ENV.fetch("AI_MONTHLY_BUDGET_USD", "3.00")) * 1_000_000).to_i
DEFAULT_AI_TASKS_PER_HOUR = Integer(ENV.fetch("AI_TASKS_PER_HOUR", "30"))
DEFAULT_MAX_IN_FLIGHT_AI_TASKS = Integer(ENV.fetch("AI_MAX_IN_FLIGHT_TASKS", "3"))
