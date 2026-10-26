/** Remember an unwanted spoken prompt without submitting, skipping, or clearing an answer. */
import { Button } from '@/components/ui/button'
import { useAvoidedInterviewPrompt } from './useAvoidedInterviewPrompt'

type Props = { interviewId: string; messageId: string; avoided: boolean; disabled: boolean }

/** Mount with the message id as its key so late saves stay attached to their original prompt. */
export function AvoidInterviewPromptButton({ interviewId, messageId, avoided, disabled }: Props) {
  const preference = useAvoidedInterviewPrompt(interviewId, messageId, avoided)
  return <div className="grid justify-items-start gap-2">
    <Button variant="outline" disabled={disabled || preference.saved || preference.saving} aria-busy={preference.saving} onClick={() => void preference.save()}>
      {preference.saved ? 'Question avoided' : preference.saving ? 'Saving preference…' : "Don't see this again"}
    </Button>
    {preference.saved && <p role="status" className="text-sm text-muted-foreground">Saved — future interviews will avoid this question.</p>}
    {preference.errors.map((error) => <p key={error} role="alert" className="text-sm">{error}</p>)}
  </div>
}
