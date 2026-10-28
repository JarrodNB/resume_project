/** Saves a desired feedback state; a failed save leaves the confirmed state intact for retry. */
import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SET_CHAT_MESSAGE_FEEDBACK } from './chatOperations'

export function useChatMessageFeedback(conversationId: string, messageId: string, thumbsDown: boolean, thumbsUp: boolean) {
  const [mutate, { loading }] = useMutation(SET_CHAT_MESSAGE_FEEDBACK)
  const [saved, setSaved] = useState({ down: thumbsDown, up: thumbsUp })
  const [errors, setErrors] = useState<string[]>([])
  const inFlight = useRef(false)
  const [source, setSource] = useState({ down: thumbsDown, up: thumbsUp })
  // A refreshed GraphQL record can contain feedback changed in another tab.
  if (source.down !== thumbsDown || source.up !== thumbsUp) {
    setSource({ down: thumbsDown, up: thumbsUp })
    setSaved({ down: thumbsDown, up: thumbsUp })
  }

  async function toggle(choice: 'up' | 'down') {
    if (inFlight.current) return
    inFlight.current = true
    setErrors([])
    try {
      const { data } = await mutate({ variables: { conversationId, messageId, ...(choice === 'up' ? { thumbsUp: !saved.up } : { thumbsDown: !saved.down }) } })
      const payload = data?.setChatMessageFeedback
      if (!payload?.message || payload.errors.length) {
        setErrors(payload?.errors.length ? payload.errors : ['Feedback was not saved. Try again.'])
        return
      }
      setSaved({ down: payload.message.thumbsDown, up: payload.message.thumbsUp })
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Feedback was not saved. Try again.')])
    } finally {
      inFlight.current = false
    }
  }
  return { saved, loading, errors, toggle }
}
