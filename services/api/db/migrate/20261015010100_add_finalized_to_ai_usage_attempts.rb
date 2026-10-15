# Description: Distinguishes an unfinished execution marker from its final accounting report.
# Index:
#   - change: allows a final report to resolve a durable unknown-cost marker once
class AddFinalizedToAiUsageAttempts < ActiveRecord::Migration[8.1]
  # Existing reports already contain their final known usage.
  def change
    add_column :ai_usage_attempts, :finalized, :boolean, null: false, default: true
  end
end
