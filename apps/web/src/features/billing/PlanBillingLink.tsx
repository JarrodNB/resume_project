/** Links to the Plan & billing page, for places that show a "free trial has ended" refusal. */
import { Link } from 'react-router'
import { PLAN_ENDED_FAILURE_CODE, PLAN_ENDED_MESSAGE } from '@/lib/planEnded'

export function PlanBillingLink() {
  return <Link to="/account/billing" className="underline underline-offset-4">Plan &amp; billing</Link>
}

/** Under an interview failure line: when the failure code is `plan_ended`, says why and links to billing. */
export function PlanEndedHint({ failureCode }: { failureCode: string | null | undefined }) {
  if (failureCode !== PLAN_ENDED_FAILURE_CODE) return null
  return <p className="text-sm">{PLAN_ENDED_MESSAGE} <PlanBillingLink /></p>
}
