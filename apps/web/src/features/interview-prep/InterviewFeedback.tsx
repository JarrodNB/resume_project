/**
 * Description: Shows coaching for a practice answer: strengths, ways to improve, and an example.
 * Feedback never changes the user's answer. Missing personal facts in the example are
 * highlighted [placeholders] for the user to fill in with their own details.
 */
import { hasFeedback } from './questionProgress'

/** Shows validated feedback text separately from the user's answer. */
export function InterviewFeedback({ feedback, outdated, unsavedChanges = false }: { feedback: unknown; outdated: boolean; unsavedChanges?: boolean }) {
  const value = feedback && typeof feedback === 'object' ? feedback as Record<string, unknown> : {}
  const strengths = Array.isArray(value.strengths) ? value.strengths.filter((item): item is string => typeof item === 'string') : []
  const improvements = Array.isArray(value.improvements) ? value.improvements.filter((item): item is string => typeof item === 'string') : []
  if (!hasFeedback(feedback)) return <aside className="question-feedback is-empty" aria-label="Answer feedback">
    <h3>Feedback</h3>
    <p>Write your answer, then choose Get feedback. You'll see what works, what to improve, and an example. Your answer stays yours: feedback never changes it.</p>
  </aside>
  return <aside className="question-feedback" aria-label="Answer feedback">
    <h3>Feedback</h3>
    {outdated && <p role="status" className="question-feedback-outdated">{unsavedChanges ? 'Out of date: this feedback is for your earlier answer. Get feedback again when you are ready.' : 'Out of date: this reviews an earlier saved answer. Get feedback again for your current answer.'}</p>}
    {strengths.length > 0 && <><h4>What works</h4><ul>{strengths.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
    {improvements.length > 0 && <><h4>Ways to improve</h4><ul>{improvements.map((text, index) => <li key={index}>{text}</li>)}</ul></>}
    {typeof value.example_answer === 'string' && <><h4>Example answer</h4><p className="whitespace-pre-wrap break-words">{value.example_answer.split(/(\[[^\]]+\])/g).map((text, index) => text.startsWith('[') ? <mark key={index}>{text}</mark> : text)}</p><p className="question-feedback-note">Replace [placeholders] with your own facts. This example does not change your answer.</p></>}
  </aside>
}
