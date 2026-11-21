/** The five stops of the landing page’s worked example, from a saved history to an interview.
 * Each one shows a made-up person, Maya, using that part of Careerdrafter. The gaps and resume
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
        <h2 id="library-title">Tell it your story once.</h2>
        <p>
          Upload the resume you already have, or type it in. Careerdrafter saves your jobs and what
          you did in each one, so you never start from a blank page again.
        </p>
      </div>
      <figure className="library-line">
        <figcaption>Meet {PERSON_NAME}. She’s a made-up example, and this is her library.</figcaption>
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
      <h2 id="job-title">Pick a job worth the effort.</h2>
      <p className="job-lede">
        Paste the link to a job posting. Careerdrafter picks out what they’re asking for. If it gets
        something wrong, you fix it.
      </p>
      <figure className="job-figure">
        <p className="job-url">
          <span>Job link</span>
          <span className="job-url-value">{JOB_POSTING_URL}</span>
        </p>
        <figcaption>
          {TARGET_JOB.title} at {TARGET_JOB.company} wants:
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
        <h2 id="gaps-title">Spot the gaps before they do.</h2>
        <p>
          Careerdrafter checks the job against your experience, one requirement at a time. Where you
          come up short, it asks you about it instead of filling the hole with something made up.
        </p>
      </div>
      <figure className="gap-board">
        <figcaption className="sr-only">
          What the job wants next to what {PERSON_NAME} has done.
        </figcaption>
        <div className="gap-row gap-row-head" aria-hidden>
          <span>The job wants</span>
          <span>What {PERSON_NAME} has</span>
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
            <span>{gapAnswered ? `Her answer: “${OPEN_GAP.answer}”` : 'Nothing yet'}</span>
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
              {gapAnswered ? 'Undo' : 'Answer as Maya'}
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
        <h2 id="resume-title">A resume you can stand behind.</h2>
        <p>
          Every line traces back to something you told it. Change any of it, then download a PDF.
        </p>
      </div>
      <figure className="resume-figure">
        <figcaption>{PERSON_NAME}’s draft, and where each line came from.</figcaption>
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
              <p className="resume-source"><span className="resume-source-stop" aria-hidden />Nothing to go on yet</p>
              <p className="resume-line">
                <span>Nothing about presenting to leaders until she answers.</span>
                <a className="text-link" href="#open-gap">Answer for her</a>
              </p>
            </li>
          )}
        </ul>
        <div className="resume-sheet-foot" aria-hidden />
      </figure>
      <a className="button button-inverse button-huge resume-cta" href={SIGN_UP_URL}>Start your first resume</a>
    </section>
  )
}

export function InterviewStop() {
  return (
    <section id="interview" className="stop stop-interview" aria-labelledby="interview-title">
      <div className="stop-copy">
        <h2 id="interview-title">Walk into the interview ready.</h2>
        <p>
          Practice the questions this job is likely to ask, typed or out loud with an AI
          interviewer. You get honest notes on what landed and what to tighten up.
        </p>
      </div>
      <figure className="question-card">
        <figcaption className="sr-only">A practice question with feedback.</figcaption>
        <p className="question-text">{INTERVIEW_EXAMPLE.question}</p>
        <div className="question-answer">
          <h3>Maya’s answer</h3>
          <p>{INTERVIEW_EXAMPLE.answer}</p>
        </div>
        <div className="question-feedback">
          <h3>Feedback</h3>
          <p>
            <span className="verdict" data-verdict="met">Works</span>
            {INTERVIEW_EXAMPLE.goodPoint}
          </p>
          <p>
            <span className="verdict" data-verdict="partial">Tighten up</span>
            {INTERVIEW_EXAMPLE.improvePoint}
          </p>
        </div>
      </figure>
    </section>
  )
}
