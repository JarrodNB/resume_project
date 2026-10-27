# Audit evidence for an operator-supplied verified receipt. Runtime delivery cannot overwrite it.
class AiUsageReconciliation < ApplicationRecord
  validates :receipt_reference, presence: true, uniqueness: true
end
