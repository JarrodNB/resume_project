/**
 * Description: Coaching and grounded example display with explicit missing-fact placeholders.
 * Index: InterviewFeedback
 */
/** Shows validated feedback text separately from the user's answer. */
export function InterviewFeedback({ feedback, outdated, unsavedChanges = false }: { feedback: unknown; outdated: boolean; unsavedChanges?: boolean }) {
  const value = feedback && typeof feedback === 'object' ? feedback as Record<string, unknown> : {}
  const strengths = Array.isArray(value.strengths) ? value.strengths.filter((item): item is string => typeof item === 'string') : []
  const improvements = Array.isArray(value.improvements) ? value.improvements.filter((item): item is string => typeof item === 'string') : []
  if (!strengths.length && !improvements.length && typeof value.example_answer !== 'string') return <p className="text-sm text-muted-foreground">Save your answer first, then request feedback when you’re ready.</p>
  return <aside className="grid min-w-0 content-start gap-3 break-words rounded-md border bg-muted/30 p-4" aria-label="Answer feedback">
    <h3 className="font-medium">Feedback</h3>
    {outdated && <p role="status" className="text-sm font-medium">{unsavedChanges ? 'Outdated feedback — you have unsaved answer changes. Save them and request feedback again.' : 'Outdated feedback — this reviews an earlier saved answer. Request feedback again for your current answer.'}</p>}
    <h4 className="font-medium">Strengths</h4><ul className="list-disc space-y-1 pl-5">{strengths.map((text, index) => <li key={index}>{text}</li>)}</ul>
    <h4 className="font-medium">Ways to improve</h4><ul className="list-disc space-y-1 pl-5">{improvements.map((text, index) => <li key={index}>{text}</li>)}</ul>
    {typeof value.example_answer === 'string' && <><h4 className="font-medium">Example answer</h4><p className="whitespace-pre-wrap break-words">{value.example_answer.split(/(\[[^\]]+\])/g).map((text, index) => text.startsWith('[') ? <mark key={index} className="rounded bg-accent px-1 text-accent-foreground">{text}</mark> : text)}</p><p className="text-sm text-muted-foreground">Replace [placeholders] with your own facts. This example does not change your answer.</p></>}
  </aside>
}
