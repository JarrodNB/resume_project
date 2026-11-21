/** Links to the Plan & billing page wherever the app says AI work is blocked because the free trial ended.
 * `MutationErrorAlert` is for mutation payloads (`errorCode: PLAN_ENDED`); `PlanEndedHint` is for
 * chat and interview failures (failure code `plan_ended`). Neither looks at message text.
 */
import type { ComponentProps } from 'react'
import { Link } from 'react-router'
import { ErrorAlert } from '@/components/ErrorAlert'
import { PLAN_ENDED_ERROR_CODE, PLAN_ENDED_FAILURE_CODE, PLAN_ENDED_MESSAGE } from '@/lib/planEnded'

export function PlanBillingLink() {
  return <Link to="/account/billing" className="underline underline-offset-4">Plan &amp; billing</Link>
}

/** The Plan & billing link when a mutation payload's `errorCode` is PLAN_ENDED; nothing otherwise. */
export function PlanEndedErrorLink({ errorCode }: { errorCode: string | null | undefined }) {
  return errorCode === PLAN_ENDED_ERROR_CODE ? <PlanBillingLink /> : null
}

type MutationErrorAlertProps = Omit<ComponentProps<typeof ErrorAlert>, 'messages' | 'action'> & {
  errors: string[]
  /** The mutation payload's `errorCode`. */
  errorCode?: string | null
}

/** ErrorAlert for a mutation's `errors`, with the Plan & billing link when `errorCode` is PLAN_ENDED. */
export function MutationErrorAlert({ errors, errorCode, ...alertProps }: MutationErrorAlertProps) {
  return <ErrorAlert {...alertProps} messages={errors} action={<PlanEndedErrorLink errorCode={errorCode} />} />
}

/** The action for an ErrorAlert about a failed chat reply: the billing link when the failure code is `plan_ended`. */
export function PlanEndedFailureLink({ failureCode }: { failureCode: string | null | undefined }) {
  return failureCode === PLAN_ENDED_FAILURE_CODE ? <PlanBillingLink /> : null
}

/** Under an interview failure line: when the failure code is `plan_ended`, says why and links to billing. */
export function PlanEndedHint({ failureCode }: { failureCode: string | null | undefined }) {
  if (failureCode !== PLAN_ENDED_FAILURE_CODE) return null
  return <p className="text-sm">{PLAN_ENDED_MESSAGE} <PlanBillingLink /></p>
}
