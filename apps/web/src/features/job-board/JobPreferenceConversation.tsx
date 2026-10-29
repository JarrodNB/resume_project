/** Focused preference dialogue proposes an editable draft; confirmation stays explicit. */
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useJobPreferenceConversation } from './useJobPreferenceConversation'

interface Props {
  version: number
  disabled: boolean
  onBusyChange: (busy: boolean) => void
  onAccepted: () => Promise<void>
}

export function JobPreferenceConversation({ version, disabled, onBusyChange, onAccepted }: Props) {
  const conversation = useJobPreferenceConversation(version, onAccepted)
  const [message, setMessage] = useState<string | null>(null)
  const [fresh, setFresh] = useState(false)
  const input = conversation.task?.input
  const failedMessage = conversation.task?.status === 'FAILED' && input && typeof input === 'object' && 'message' in input && typeof input.message === 'string' ? input.message : ''
  const displayedMessage = message ?? failedMessage
  useEffect(() => { onBusyChange(conversation.busy) }, [conversation.busy, onBusyChange])

  return <div className="grid gap-3 rounded border p-4">
    <h3 className="font-semibold">Talk through what matters</h3>
    <p className="text-sm text-muted-foreground">Describe your next job in your own words. We’ll help clarify it and save an editable draft for you to review and confirm below.</p>
    {conversation.turns.length > 0 && <ol aria-label="Preference conversation" className="grid gap-3">
      {conversation.turns.map((turn, index) => <li key={index} className="grid gap-1 text-sm">
        <p><span className="font-semibold">You:</span> {turn.userMessage}</p>
        <p><span className="font-semibold">Assistant:</span> {turn.assistantMessage}</p>
      </li>)}
    </ol>}
    {conversation.stale && <p role="status">Your preferences changed after this conversation. Your next message starts from the current draft.</p>}
    {conversation.loading && <p role="status">Loading conversation…</p>}
    <ErrorAlert title="Couldn't continue the conversation" messages={conversation.errors} />
    {conversation.errors.length > 0 && <Button type="button" variant="outline" onClick={() => void conversation.reload()}>Reload conversation</Button>}
    <form className="grid gap-2" onSubmit={(event) => { event.preventDefault(); void conversation.send(displayedMessage, fresh).then((queued) => { if (queued) { setMessage(null); setFresh(false) } }) }}>
      <Label htmlFor="next-job-message">Tell me what you want next</Label>
      <Textarea id="next-job-message" value={displayedMessage} maxLength={4000} disabled={conversation.busy || disabled || conversation.loading}
        onChange={(event) => setMessage(event.target.value)} placeholder="I need fully remote work in the US. Climate work would be a bonus." />
      {disabled && <p className="text-sm text-muted-foreground">Save or undo your manual edits before sending a message.</p>}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={conversation.busy || disabled || conversation.loading || !displayedMessage.trim()}>Send preferences</Button>
        {conversation.task && !fresh && <Button type="button" variant="ghost" disabled={conversation.busy} onClick={() => setFresh(true)}>Start a new conversation</Button>}
      </div>
      {fresh && <p role="status">Your next message starts a new conversation using the current draft.</p>}
    </form>
    {conversation.busy && <p role="status">Working on your preferences…</p>}
  </div>
}
