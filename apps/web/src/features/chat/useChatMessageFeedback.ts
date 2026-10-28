/** Saves a desired feedback state; a failed save leaves the confirmed state intact for retry. */
import { useRef, useState } from 'react'
import { useMutation } from '@apollo/client/react'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { SET_CHAT_MESSAGE_FEEDBACK } from './chatOperations'

export function useChatMessageFeedback(conversationId: string, messageId: string, thumbsDown: boolean) {
  const [mutate, { loading }] = useMutation(SET_CHAT_MESSAGE_FEEDBACK)
  const [saved, setSaved] = useState(thumbsDown)
  const [errors, setErrors] = useState<string[]>([])
  const inFlight = useRef(false)
  const [source, setSource] = useState(thumbsDown)
  // A refreshed GraphQL record can contain feedback changed in another tab.
  if (source !== thumbsDown) {
    setSource(thumbsDown)
    setSaved(thumbsDown)
  }

  async function toggle() {
    if (inFlight.current) return
    inFlight.current = true
    setErrors([])
    try {
      const { data } = await mutate({ variables: { conversationId, messageId, thumbsDown: !saved } })
      const payload = data?.setChatMessageFeedback
      if (!payload?.message || payload.errors.length) {
        setErrors(payload?.errors.length ? payload.errors : ['Feedback was not saved. Try again.'])
        return
      }
      setSaved(payload.message.thumbsDown)
    } catch (error) {
      setErrors([requestErrorMessage(error, 'Feedback was not saved. Try again.')])
    } finally {
      inFlight.current = false
    }
  }
  return { saved, loading, errors, toggle }
}
