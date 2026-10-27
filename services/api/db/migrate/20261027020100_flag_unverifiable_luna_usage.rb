# Old queued Luna receipts omitted cache-write tokens, so their known subtotal may be low.
# Preserve every bill but stop presenting these receipts as complete until verified.
class FlagUnverifiableLunaUsage < ActiveRecord::Migration[8.1]
  def up
    execute <<~SQL
      UPDATE ai_usage_attempts
      SET incomplete = TRUE
      WHERE EXISTS (
        SELECT 1 FROM jsonb_array_elements(usage) AS entry
        WHERE entry->>'model' = 'openai:gpt-6-luna'
          AND NOT (entry ? 'cache_write_tokens')
      )
    SQL
  end

  # Lost usage cannot be restored on rollback; retain the uncertainty marker.
  def down
  end
end
