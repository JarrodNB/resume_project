# One provider response's reported usage inside an execution attempt.
# A NULL count means the provider did not report it; a NULL cost means the price is unknown.
# Rows are written only through AiUsage::AttemptEntries so task totals stay in step.
class AiUsageEntry < ApplicationRecord
  belongs_to :ai_usage_attempt
  belongs_to :ai_task
end
