/** Shows the result of answering one gap before the visitor reads the full walkthrough.
 * This is a scripted example, not a live AI response. Its answer is shared with the gaps
 * and resume stops so visitors can follow the same evidence through the page.
 */
import { ANSWERED_RESUME_LINE, OPEN_GAP, PERSON_NAME, TARGET_JOB } from './workedExample'

interface ExamplePreviewProps {
  gapAnswered: boolean
  onToggleGapAnswer: () => void
}

export function ExamplePreview({ gapAnswered, onToggleGapAnswer }: ExamplePreviewProps) {
  return (
    <section id="example" className="example-preview" aria-labelledby="example-title">
      <div className="example-heading">
        <h2 id="example-title">See how one answer changes the draft.</h2>
        <p>A scripted example with {PERSON_NAME}, applying for {TARGET_JOB.title}. She and the job are made up.</p>
      </div>
      <div className="example-columns">
        <div className="example-question">
          <h3>The job asks for evidence.</h3>
          <p>{OPEN_GAP.question}</p>
          <p className="example-answer">{gapAnswered ? `Maya’s answer: “${OPEN_GAP.answer}”` : 'Her saved history doesn’t mention this yet. Careergrind asks her instead of filling in the blank.'}</p>
          <button
            type="button"
            className="button button-primary"
            aria-controls="example-result open-gap resume-gap-line"
            onClick={onToggleGapAnswer}
          >
            {gapAnswered ? 'Remove Maya’s answer' : 'Try Maya’s answer'}
          </button>
        </div>
        <div id="example-result" className="example-result" data-answered={gapAnswered || undefined}>
          <h3>{gapAnswered ? 'Now her draft has a source.' : 'Without evidence, it stays off the draft.'}</h3>
          <p className="example-resume-line">{gapAnswered ? ANSWERED_RESUME_LINE.text : 'No claim about presenting to senior leaders.'}</p>
          <p className="example-source">{gapAnswered ? `Source: ${ANSWERED_RESUME_LINE.source.toLowerCase()}. She still reviews the wording.` : 'Add her answer to see the resume line it supports.'}</p>
          <a className="text-link" href="#resume-gap-line">See the full draft</a>
        </div>
      </div>
      <a className="example-next text-link" href="#library">Follow her application from the start</a>
    </section>
  )
}
