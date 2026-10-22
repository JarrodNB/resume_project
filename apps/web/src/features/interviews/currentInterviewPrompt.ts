/** Find the saved prompt the candidate is answering without losing the main question.
 * A previous question's late response cannot become the next question's prompt.
 */
import type { InterviewSnapshotFragment } from '@/graphql/generated/graphql'

export function currentInterviewPrompt(interview: InterviewSnapshotFragment) {
  const question = interview.questions.find((item) => item.position === interview.currentQuestionPosition)
  const reply = interview.messages.filter((message) => message.kind !== 'answer' && (
    interview.status === 'completed' || message.questionId === question?.id
  )).at(-1)
  return { question, reply }
}
