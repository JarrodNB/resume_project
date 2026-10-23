# Independent per-user limits for general AI and spoken interviews. General AI uses
# the user's non-null override columns; spoken interviews use their own environment defaults.
# Enforced by AiUsage::CheckAiTaskAllowanceService before a task is queued.
# Index:
#   - DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS: estimated LLM spend allowed per calendar month (UTC)
#   - DEFAULT_AI_TASKS_PER_HOUR: tasks a user may start in any rolling hour
#   - DEFAULT_MAX_IN_FLIGHT_AI_TASKS: queued tasks a user may have at once
DEFAULT_MONTHLY_AI_BUDGET_MICRODOLLARS = (BigDecimal(ENV.fetch("AI_MONTHLY_BUDGET_USD", "3.00")) * 1_000_000).to_i
DEFAULT_AI_TASKS_PER_HOUR = Integer(ENV.fetch("AI_TASKS_PER_HOUR", "30"))
DEFAULT_MAX_IN_FLIGHT_AI_TASKS = Integer(ENV.fetch("AI_MAX_IN_FLIGHT_TASKS", "3"))

DEFAULT_INTERVIEW_MONTHLY_BUDGET_MICRODOLLARS = (BigDecimal(ENV.fetch("INTERVIEW_MONTHLY_BUDGET_USD", "3.00")) * 1_000_000).to_i
DEFAULT_INTERVIEW_SESSIONS_PER_HOUR = Integer(ENV.fetch("INTERVIEW_SESSIONS_PER_HOUR", "30"))
DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS = Integer(ENV.fetch("INTERVIEW_MAX_IN_FLIGHT_OPERATIONS", "3"))
