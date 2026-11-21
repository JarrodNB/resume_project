# Per-user AI limits, enforced by AiUsage::CheckAiTaskAllowanceService before a task is queued.
# Each user has one hidden daily spend cap per UTC day, shared by general AI and spoken interviews.
# The cap depends on the user's plan (see Billing::ResolvePlanService). Cap values are never shown to users.
# Index:
#   - TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS: known spend a trial user may use per UTC day
#   - PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS: known spend a paying user may use per UTC day
#   - DEFAULT_AI_TASKS_PER_HOUR: general AI tasks a user may start in any rolling hour
#   - DEFAULT_MAX_IN_FLIGHT_AI_TASKS: queued general AI tasks a user may have at once
#   - DEFAULT_INTERVIEW_SESSIONS_PER_HOUR, DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS: the same for spoken interviews
#   - SITE_DAILY_AI_BUDGET_MICRODOLLARS: known trial-user spend allowed across all users per UTC day (see AiUsage::SiteDailySpend)
TRIAL_DAILY_AI_SPEND_CAP_MICRODOLLARS = (BigDecimal(ENV.fetch("TRIAL_DAILY_AI_SPEND_CAP_USD", "0.25")) * 1_000_000).to_i
PAID_DAILY_AI_SPEND_CAP_MICRODOLLARS = (BigDecimal(ENV.fetch("PAID_DAILY_AI_SPEND_CAP_USD", "2.00")) * 1_000_000).to_i

DEFAULT_AI_TASKS_PER_HOUR = Integer(ENV.fetch("AI_TASKS_PER_HOUR", "40"))
DEFAULT_MAX_IN_FLIGHT_AI_TASKS = Integer(ENV.fetch("AI_MAX_IN_FLIGHT_TASKS", "3"))

DEFAULT_INTERVIEW_SESSIONS_PER_HOUR = Integer(ENV.fetch("INTERVIEW_SESSIONS_PER_HOUR", "10"))
DEFAULT_MAX_IN_FLIGHT_INTERVIEW_OPERATIONS = Integer(ENV.fetch("INTERVIEW_MAX_IN_FLIGHT_OPERATIONS", "3"))

SITE_DAILY_AI_BUDGET_MICRODOLLARS = (BigDecimal(ENV.fetch("AI_SITE_DAILY_BUDGET_USD", "5.00")) * 1_000_000).to_i
