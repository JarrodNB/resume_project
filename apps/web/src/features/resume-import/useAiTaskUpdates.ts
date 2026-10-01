/**
 * Description: Hook that follows an AI task live over the aiTaskUpdated subscription.
 * Index:
 *   - useAiTaskUpdates: returns the latest task state and any subscription error
 */
import { useSubscription } from '@apollo/client/react'
import { AI_TASK_UPDATED_SUBSCRIPTION } from './resumeImportOperations'

/** Subscribes to an AI task. The server sends its current state immediately, then every change. */
export function useAiTaskUpdates(aiTaskId: string) {
  const { data, error } = useSubscription(AI_TASK_UPDATED_SUBSCRIPTION, { variables: { id: aiTaskId } })
  return { aiTask: data?.aiTaskUpdated ?? null, error }
}
