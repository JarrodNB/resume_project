/**
 * Description: Asks for five new practice questions of one type, built from the career library.
 * The new questions join the question bank here when generation finishes.
 * Generation stays locked while a persisted generation task is running, including after reload.
 */
import { Link } from 'react-router'
import { useState } from 'react'
import type { InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import { requestErrorMessage } from '@/graphql/requestErrorMessage'
import { useCareerLibrary } from '@/features/career-library/useCareerLibrary'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { useGenerateInterviewSet } from './useInterviewPrep'

const SET_TYPES: InterviewQuestionSetTypeEnum[] = ['FIT_MOTIVATION', 'BEHAVIORAL', 'HYPOTHETICAL', 'TECHNICAL', 'KNOWLEDGE']
const TYPE_HELP: Record<InterviewQuestionSetTypeEnum, string> = {
  FIT_MOTIVATION: 'Your background, motivation, goals, working preferences, and contribution.',
  BEHAVIORAL: 'Real examples of collaboration, problem solving, adaptation, initiative, and judgment.',
  HYPOTHETICAL: 'How you would handle a situation: priorities, reasoning, communication, and checking the outcome.',
  TECHNICAL: 'How you actually do your work: methods, tools, decisions, tradeoffs, and quality.',
  KNOWLEDGE: 'Whether you understand the subjects in your field. Feedback corrects wrong facts.',
}

/** Type switch and generate button, with links to fill an empty library first. */
export function GenerateQuestionSet({ generating, checking }: { generating: boolean; checking: boolean }) {
  const { library, loading: libraryLoading, error: libraryError } = useCareerLibrary()
  const generation = useGenerateInterviewSet()
  const busy = generation.loading || generating || checking
  const [setType, setSetType] = useState<InterviewQuestionSetTypeEnum>('FIT_MOTIVATION')
  const hasCareerContext = Boolean(library && (
    library.me.summary?.trim() || library.experiences.length || library.projects.length ||
    library.educations.length || library.certifications.length || library.skills.length || library.careerContexts.length
  ))

  return <section className="question-generate" aria-labelledby="question-generate-heading">
    <div className="question-generate-text">
      <h2 id="question-generate-heading">Get new questions</h2>
      <p>Five questions built from your career library. Saved questions stay the same when your library changes.</p>
    </div>
    <div className="question-generate-controls">
      <div className="view-switch question-type-switch" role="group" aria-label="Question type" aria-describedby="question-type-help">
        {SET_TYPES.map((type) => <button key={type} type="button" aria-pressed={setType === type} disabled={busy} onClick={() => setSetType(type)}>{interviewSetTypeLabel(type)}</button>)}
      </div>
      <p id="question-type-help" className="question-generate-help" aria-live="polite">{TYPE_HELP[setType]}</p>
      <Button size="lg" disabled={busy || !hasCareerContext} onClick={() => void generation.generate(setType)}>{generating ? 'Generating questions…' : generation.loading ? 'Starting…' : checking ? 'Checking generation…' : 'Get 5 questions'}</Button>
    </div>
    {!hasCareerContext && !libraryError && <div className="question-generate-empty" aria-live="polite">
      {libraryLoading ? <p>Checking your career library…</p> : <>
        <p>Add career details before getting interview questions.</p>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          <Link to="/library/import">Import a resume</Link>
          <Link to="/library">Add details in your career library</Link>
        </div>
      </>}
    </div>}
    <ErrorAlert title="Couldn't get questions" messages={generation.errors} />
    {libraryError && <ErrorAlert title="Couldn't check your career library" messages={[requestErrorMessage(libraryError, libraryError.message)]} />}
  </section>
}
