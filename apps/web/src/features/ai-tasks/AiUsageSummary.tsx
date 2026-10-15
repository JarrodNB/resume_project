/**
 * Description: Compact monthly AI spend and budget display for the signed-in layout.
 * Index:
 *   - AiUsageSummary: known cost summary and unavailable state
 */
import { useAiUsage } from './useAiUsage'

const dollars = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 6,
})

/** Renders known spend without showing a failed lookup as zero usage. */
export function AiUsageSummary() {
  const { usage, error } = useAiUsage()
  if (error) return <p className="text-xs text-muted-foreground">AI cost summary unavailable.</p>
  if (!usage) return null
  return (
    <div className="text-xs text-muted-foreground" aria-live="polite">
      <p>Known AI cost this month: {dollars.format(usage.spentThisMonthUsd)} / {dollars.format(usage.monthlyBudgetUsd)}</p>
      {usage.incompleteAttempts > 0 && <p>Some request costs are unknown; actual spend may be higher.</p>}
    </div>
  )
}
