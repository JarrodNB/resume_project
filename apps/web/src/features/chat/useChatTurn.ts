/** Own a logical send and observe current-attempt output without starting work on reconnect.
 * Failed transport retains the submission key; a manual resend reconciles saved state first.
 */
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useMutation, useQuery, useSubscription } from '@apollo/client/react'
import type { ChatOperationQuery } from '@/graphql/generated/graphql'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { observeChatOutput } from './chatOutputStream'
import { AUTHORIZE_CHAT_OUTPUT, CHAT_CONVERSATION_UPDATED, CHAT_OPERATION_QUERY, RETRY_CHAT_MESSAGE, SEND_CHAT_MESSAGE } from './chatTurnOperations'

export type ChatOperation = NonNullable<ChatOperationQuery['chatConversation']['latestOperation']>
// Date.parse discards microseconds. Keep the server's complete ordering when state
// transitions and their delayed receipts fall within the same millisecond.
function newer(left: ChatOperation, right: ChatOperation) {
  const difference = Date.parse(left.updatedAt) - Date.parse(right.updatedAt)
  if (difference !== 0) return difference > 0
  const micros = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(6, '0').slice(0, 6)
  return micros(left.updatedAt) > micros(right.updatedAt)
}
const failureMessages: Record<string, string> = {
  screening_blocked: 'This message could not pass the input check. Rephrase it and try again.',
  screening_unavailable: 'The input check is unavailable. Try this message again shortly.',
  context_limit: 'This conversation is too long to continue safely. Start a new chat.',
  execution_failed: 'Careergrind could not finish the reply. You can try again.',
  execution_timeout: 'The reply took too long. You can try again.',
  lease_expired: 'The reply was interrupted. You can try again.',
  dependency_unavailable: 'The AI service is unavailable. Try again shortly.',
  ai_usage_limit_reached: 'Your AI usage limit has been reached. Try again after it resets.',
}
export const chatFailureMessage = (code: string | null) => failureMessages[code ?? ''] ?? 'Careergrind could not finish the reply. You can try again.'

export function useChatTurn(conversationId: string, onAccepted: () => void) {
  const query = useQuery(CHAT_OPERATION_QUERY, { variables: { id: conversationId }, fetchPolicy: 'no-cache' })
  const [latest, setLatest] = useState<ChatOperation | null>(null)
  const saved = query.data?.chatConversation.latestOperation ?? null
  const operation = saved && (!latest || newer(saved, latest)) ? saved : latest
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState({ attempt: '', text: '' })
  const retained = useRef<{ key: string; text: string } | null>(null)
  const writing = useRef(false)
  const acceptedId = useRef<string | null>(null)
  const notifyAccepted = useEffectEvent(onAccepted)
  const [sendMutation] = useMutation(SEND_CHAT_MESSAGE)
  const [retryMutation] = useMutation(RETRY_CHAT_MESSAGE)
  const [authorize] = useMutation(AUTHORIZE_CHAT_OUTPUT)

  function update(next: ChatOperation | null | undefined) {
    if (!next) return
    setLatest((previous) => previous && newer(previous, next) ? previous : next)
  }
  const subscription = useSubscription(CHAT_CONVERSATION_UPDATED, { variables: { id: conversationId }, fetchPolicy: 'no-cache',
    onData: ({ data }) => update(data.data?.chatConversationUpdated.latestOperation),
  })

  useEffect(() => {
    if (operation?.status !== 'accepted' || acceptedId.current === operation.id) return
    acceptedId.current = operation.id
    retained.current = null
    notifyAccepted()
  }, [operation])

  const running = operation?.status === 'running'
  const pending = operation?.status === 'pending' || running
  const operationId = operation?.id
  const attemptId = operation?.attemptId
  const claimGeneration = operation?.claimGeneration ?? 0
  const attempt = `${operationId}:${attemptId}:${claimGeneration}`
  const provisional = output.attempt === attempt ? output.text : ''
  const reconcile = useEffectEvent(() => {
    void query.refetch().then((result) => {
      update(result.data?.chatConversation.latestOperation)
    }).catch(() => setErrors(['Could not check the saved reply. Reload this chat when connected.']))
  })
  useEffect(() => {
    if (!running || !operationId || !attemptId) return
    return observeChatOutput({ operation: { id: operationId, attemptId, claimGeneration },
      authorize: async () => {
        const result = await authorize({ variables: { input: { feature: 'chat', operationId } } })
        const payload = result.data?.authorizeAiExecutionStream
        return payload && !payload.errors.length ? payload.token : null
      },
      onText: (text) => setOutput({ attempt, text }),
      onReconcile: () => reconcile(),
    })
  }, [running, operationId, attemptId, claimGeneration, attempt, authorize])

  async function send(text: string) {
    if (writing.current || pending) return false
    writing.current = true
    setBusy(true)
    setErrors([])
    try {
      if (retained.current && retained.current.text !== text) throw new Error('Check the previous message’s saved status before sending a different message.')
      if (retained.current) {
        const saved = (await query.refetch()).data?.chatConversation.latestOperation
        update(saved)
        if (saved?.idempotencyKey === retained.current.key) { retained.current = null; return true }
      } else retained.current = { key: crypto.randomUUID(), text }
      const submission = retained.current!
      const result = (await sendMutation({ variables: { input: { conversationId, message: submission.text, idempotencyKey: submission.key } } })).data?.sendChatMessage
      if (result?.errors.length) { retained.current = null; throw new Error(result.errors.join(' ')) }
      if (!result?.operation) throw new Error('No saved status was received. Retry the same message to check its status safely.')
      update(result.operation)
      retained.current = null
      return true
    } catch (error) {
      setErrors([requestErrorMessage(error, error instanceof Error ? error.message : 'Could not send the message. Try again.')])
      return false
    } finally { setBusy(false); writing.current = false }
  }
  async function retry() {
    if (writing.current || pending || !operation) return
    writing.current = true
    setBusy(true)
    setErrors([])
    try {
      // Read first: an ambiguous earlier request may already have retried/finished.
      const latest = (await query.refetch()).data?.chatConversation.latestOperation
      update(latest)
      if (latest?.id !== operation.id || latest.status !== 'failed') return
      const result = (await retryMutation({ variables: { input: { operationId: operation.id } } })).data?.retryChatMessage
      if (!result?.operation || result.errors.length) throw new Error(result?.errors.join(' ') || 'Could not retry this message.')
      update(result.operation)
    } catch (error) { setErrors([requestErrorMessage(error, error instanceof Error ? error.message : 'Could not retry this message.')]) }
    finally { setBusy(false); writing.current = false }
  }
  return { operation, pending, busy, provisional, send, retry, refetch: query.refetch,
    error: query.error, liveError: subscription.error, checking: query.loading && !query.data, errors }
}
