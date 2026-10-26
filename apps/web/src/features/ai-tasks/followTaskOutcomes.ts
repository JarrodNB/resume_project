/** Recovers ordered task outcomes before displaying them and sharing a browser checkpoint.
 * A Web Lock makes delivery/checkpoint updates atomic across tabs. Hidden tabs leave
 * outcomes on the server until visible. Without storage/locks, live delivery still works,
 * while cross-tab and reload guarantees degrade to the available browser facilities. */
import type { ApolloClient } from '@apollo/client'
import { productStorageKey } from '@/lib/productName'
import { TASK_OUTCOME_SUBSCRIPTION, TASK_OUTCOMES_QUERY } from './taskNotificationOperations'
import type { TaskOutcomeSubscription, TaskOutcomesQuery } from '@/graphql/generated/graphql'

export type TaskNotice = NonNullable<TaskOutcomeSubscription['aiTaskFinished']['outcome']>
const MAX_CURSOR = 9223372036854775807n
function validCursor(value: unknown): value is string {
  return typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= MAX_CURSOR
}
const maximum = (a: string, b: string) => BigInt(a) > BigInt(b) ? a : b

/** Owns one authenticated feed; stop it before replacing the account or Apollo client. */
export function followTaskOutcomes(client: ApolloClient, userId: string, initialCursor: string | null | undefined, onNotice: (notice: TaskNotice) => void) {
  const key = productStorageKey(`taskOutcomes.${userId}`)
  let active = true
  let highWater: string | null = null
  let memoryCursor: string | null = null
  let running = false
  let requested = false
  let validateCheckpoint = true
  let subscriptionFailed = false

  function readCursor() {
    try {
      const value = localStorage.getItem(key)
      if (validCursor(value)) return memoryCursor === null ? value : maximum(value, memoryCursor)
    } catch { /* Memory retains live delivery when storage is unavailable. */ }
    return memoryCursor
  }
  function saveCursor(cursor: string) {
    memoryCursor = cursor
    try { localStorage.setItem(key, cursor) } catch { /* See module limits above. */ }
  }

  const hidden = () => document.visibilityState === 'hidden'

  async function deliver() {
    if (!active || highWater === null) return
    const stored = readCursor()
    let cursor: string = stored ?? (validCursor(initialCursor) ? initialCursor : highWater)
    if (stored === null) saveCursor(cursor)
    if (hidden()) return
    if (!validateCheckpoint && BigInt(cursor) >= BigInt(highWater)) return
    // A restored/corrupt future checkpoint is validated against the server, while a
    // valid checkpoint ahead of a stale handshake is preserved without replay.
    const through = maximum(cursor, highWater)
    do {
      const response = await client.query<TaskOutcomesQuery>({ query: TASK_OUTCOMES_QUERY,
        variables: { after: cursor, through }, fetchPolicy: 'no-cache' })
      if (!active || hidden()) return
      const page: TaskOutcomesQuery['taskOutcomes'] | undefined = response.data?.taskOutcomes
      if (!page || !validCursor(page.cursor)) throw new Error('Task outcome recovery unavailable')
      for (const notice of page.outcomes) onNotice(notice)
      cursor = page.cursor
      saveCursor(cursor)
      validateCheckpoint = false
      if (!page.hasMore) break
    } while (active)
    if (highWater !== null && BigInt(through) < BigInt(highWater)) requested = true
  }

  async function exclusiveDelivery() {
    if (navigator.locks?.request) {
      let entered = false
      try {
        await navigator.locks.request(key, async () => { entered = true; await deliver() })
      } catch (error) {
        if (entered) throw error
        await deliver()
      }
    } else await deliver()
  }
  function schedule() {
    if (subscriptionFailed && active) startSubscription()
    requested = true
    if (running || !active) return
    running = true
    requested = false
    void exclusiveDelivery().catch(() => {
      // Keep the checkpoint unchanged; registration, visibility and online events retry.
    }).finally(() => {
      running = false
      if (active && requested) schedule()
    })
  }

  let subscription: { unsubscribe: () => void } | undefined
  function startSubscription() {
    subscriptionFailed = false
    subscription?.unsubscribe()
    subscription = client.subscribe({ query: TASK_OUTCOME_SUBSCRIPTION, fetchPolicy: 'no-cache' }).subscribe({
      next({ data, error }) {
        if (error) { subscriptionFailed = true; return }
        const feed = data?.aiTaskFinished
        if (!active || !feed || !validCursor(feed.cursor)) return
        highWater = highWater === null ? feed.cursor : maximum(highWater, feed.cursor)
        schedule()
      },
      error() { subscriptionFailed = true },
      complete() { subscriptionFailed = true },
    })
  }
  startSubscription()
  document.addEventListener('visibilitychange', schedule)
  window.addEventListener('online', schedule)
  return () => {
    active = false
    subscription?.unsubscribe()
    document.removeEventListener('visibilitychange', schedule)
    window.removeEventListener('online', schedule)
  }
}
