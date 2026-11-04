/** The five stops of the landing page’s worked example, from a saved history to an interview.
 * Each one shows a made-up person, Maya, using that part of Careergrind. The opening preview, gaps and resume
 * stops share one small piece of state: answering her gap puts a new line on her resume. The
 * page is static, so that is a scripted demo and no AI runs here.
 */
import { SIGN_UP_URL } from './appLinks'
import {
  ANSWERED_RESUME_LINE,
  GAP_ROWS,
  INTERVIEW_EXAMPLE,
  JOB_POSTING_URL,
  JOB_REQUIREMENTS,
  LIBRARY_CONTEXT_NOTE,
  LIBRARY_ROLES,
  OPEN_GAP,
  PERSON_NAME,
  RESUME_LINES,
  TARGET_JOB,
  type RequirementVerdict,
} from './workedExample'

export function LibraryStop() {
  return (
    <section id="library" className="stop stop-library" aria-labelledby="library-title">
      <div className="stop-copy">
        <h2 id="library-title">Tell your history once.</h2>
        <p>
          Import a PDF or Word resume and review it, or add your experience yourself. Save it in
          your career library to reuse for each application.
        </p>
      </div>
      <figure className="library-line">
        <figcaption>{PERSON_NAME}’s library. She is made up, for this example.</figcaption>
        <ol>
          {LIBRARY_ROLES.map((role) => (
            <li key={role.title} className="library-role" data-current={role.current || undefined}>
              <span className="library-dates">{role.dates}</span>
              <div>
                <h3>{role.title}</h3>
                <p className="library-company">{role.company}</p>
                <ul>
                  {role.details.map((detail) => (
                    <li key={detail}>{detail}</li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
        <p className="library-context">{LIBRARY_CONTEXT_NOTE}</p>
      </figure>
    </section>
  )
}

export function JobStop() {
  return (
    <section id="job" className="stop stop-job" aria-labelledby="job-title">
      <h2 id="job-title">Pick one job you actually want.</h2>
      <p className="job-lede">
        Save a posting from its link, or paste it in. Careergrind pulls out what the job is asking
        for, and you can fix anything it got wrong.
      </p>
      <figure className="job-figure">
        <p className="job-url">
          <span>Posting link</span>
          <span className="job-url-value">{JOB_POSTING_URL}</span>
        </p>
        <figcaption>
          {TARGET_JOB.title} at {TARGET_JOB.company}, a made-up job. It asks for:
        </figcaption>
        <ul className="job-requirements">
          {JOB_REQUIREMENTS.map((requirement) => (
            <li key={requirement}>{requirement}</li>
          ))}
        </ul>
      </figure>
    </section>
  )
}

const VERDICT_LABEL: Record<RequirementVerdict, string> = { met: 'Met', partial: 'Partial', missing: 'Missing' }

function VerdictBadge({ verdict }: { verdict: RequirementVerdict }) {
  return <span className="verdict" data-verdict={verdict}>{VERDICT_LABEL[verdict]}</span>
}

interface GapsStopProps {
  gapAnswered: boolean
  onToggleGapAnswer: () => void
}

export function GapsStop({ gapAnswered, onToggleGapAnswer }: GapsStopProps) {
  return (
    <section id="gaps" className="stop stop-gaps" aria-labelledby="gaps-title">
      <div className="stop-copy-wide">
        <h2 id="gaps-title">See what’s missing. Then you fill it.</h2>
        <p>
          Careergrind compares your library with the job, line by line. Where it finds nothing, it
          says so and asks you. It doesn’t make something up to close the gap.
        </p>
      </div>
      <figure className="gap-board">
        <figcaption className="sr-only">
          {PERSON_NAME}’s record compared with what the job asks for. Made-up example.
        </figcaption>
        <div className="gap-row gap-row-head" aria-hidden>
          <span>The job asks for</span>
          <span>{PERSON_NAME}’s record</span>
          <span />
        </div>
        {GAP_ROWS.map((row) => (
          <div className="gap-row" key={row.requirement}>
            <strong>{row.requirement}</strong>
            <span>{row.evidence}</span>
            <VerdictBadge verdict={row.verdict} />
          </div>
        ))}
        <div id="open-gap" className="gap-open" data-answered={gapAnswered || undefined}>
          <div className="gap-row">
            <strong>{OPEN_GAP.requirement}</strong>
            <span>{gapAnswered ? `Her answer: “${OPEN_GAP.answer}”` : 'Nothing in her library yet'}</span>
            <VerdictBadge verdict={gapAnswered ? 'met' : 'missing'} />
          </div>
          {!gapAnswered && (
            <p className="gap-question">
              <span className="signal-dot" data-signal="action" aria-hidden />
              {OPEN_GAP.question}
            </p>
          )}
          <div className="gap-actions">
            {gapAnswered && (
              <a className="button button-primary button-huge" href="#resume-gap-line">See it on her resume</a>
            )}
            {/* Keep the same button mounted so keyboard focus survives either action. */}
            <button
              type="button"
              className={gapAnswered ? 'text-link text-button' : 'button button-primary button-huge'}
              aria-controls="open-gap resume-gap-line"
              onClick={onToggleGapAnswer}
            >
              {gapAnswered ? 'Take the answer back' : 'Answer as Maya'}
            </button>
          </div>
        </div>
      </figure>
      <p className="sr-only" role="status">
        {gapAnswered
          ? 'Answer saved. A new line was added to the example resume.'
          : 'No answer saved. The unsupported line stays off the example resume.'}
      </p>
    </section>
  )
}

function ResumeRow({ text, source, id }: { text: string; source: string; id?: string }) {
  return (
    <li className="resume-row" id={id}>
      <p className="resume-source"><span className="resume-source-stop" aria-hidden />{source}</p>
      <p className="resume-line">{text}</p>
    </li>
  )
}

export function ResumeStop({ gapAnswered }: { gapAnswered: boolean }) {
  return (
    <section id="resume" className="stop stop-resume" aria-labelledby="resume-title">
      <div className="stop-copy-wide">
        <h2 id="resume-title">Every line comes from your record.</h2>
        <p>
          Review a draft drawn from your library and answers. Edit the wording, then export a PDF.
        </p>
      </div>
      <figure className="resume-figure">
        <figcaption>{PERSON_NAME}’s draft. Our notes show where each line came from.</figcaption>
        <div className="resume-sheet-head">
          <span className="resume-name">{PERSON_NAME}</span>
          <span className="resume-for">For {TARGET_JOB.title}, {TARGET_JOB.company}</span>
          <span className="resume-heading">Experience</span>
        </div>
        <ul className="resume-rows">
          {RESUME_LINES.map((line) => (
            <ResumeRow key={line.text} {...line} />
          ))}
          {gapAnswered ? (
            <ResumeRow id="resume-gap-line" {...ANSWERED_RESUME_LINE} />
          ) : (
            <li id="resume-gap-line" className="resume-row resume-row-empty">
              <p className="resume-source"><span className="resume-source-stop" aria-hidden />No record of this yet</p>
              <p className="resume-line">
                <span>Presenting to senior leaders stays off her resume until she answers.</span>
                <a className="text-link" href="#open-gap">Answer the gap</a>
              </p>
            </li>
          )}
        </ul>
        <div className="resume-sheet-foot" aria-hidden />
      </figure>
      <a className="button button-inverse button-huge resume-cta" href={SIGN_UP_URL}>Sign up and write yours</a>
    </section>
  )
}

export function InterviewStop() {
  return (
    <section id="interview" className="stop stop-interview" aria-labelledby="interview-title">
      <div className="stop-copy">
        <h2 id="interview-title">Practice before it counts.</h2>
        <p>
          Practice questions for this job and get feedback on your answers. Try a mock interview
          with an AI interviewer, using voice or typing. Questions draw on the job and your library.
        </p>
      </div>
      <figure className="question-card">
        <figcaption className="sr-only">Made-up practice question with feedback.</figcaption>
        <p className="question-text">{INTERVIEW_EXAMPLE.question}</p>
        <div className="question-answer">
          <h3>Maya’s answer</h3>
          <p>{INTERVIEW_EXAMPLE.answer}</p>
        </div>
        <div className="question-feedback">
          <h3>Feedback</h3>
          <p>
            <span className="verdict" data-verdict="met">Looks good</span>
            {INTERVIEW_EXAMPLE.goodPoint}
          </p>
          <p>
            <span className="verdict" data-verdict="partial">Could improve</span>
            {INTERVIEW_EXAMPLE.improvePoint}
          </p>
        </div>
      </figure>
    </section>
  )
}
