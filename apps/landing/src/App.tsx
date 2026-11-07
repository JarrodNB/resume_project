/** The Careergrind landing page: one ride from a person’s history to an interview, then sign-up.
 * Static and public. Its only state is the scripted gap answer in the worked example, and its
 * only ways out are links to the web app.
 */
import { useState } from 'react'
import { PRIVACY_URL, SIGN_IN_URL, SIGN_UP_URL, TERMS_URL } from './appLinks'
import { LineStrip } from './LineStrip'
import { ExamplePreview } from './ExamplePreview'
import { GapsStop, InterviewStop, JobStop, LibraryStop, ResumeStop } from './RideStops'
import { SearchMap } from './SearchMap'

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <h1 id="hero-title">Your experience.<br />A resume for the job you want.</h1>
      <div className="hero-action">
        <p>
          Build a career library from what you’ve actually done. Use it to write a tailored resume
          you review, keep your search organized, and practice with an AI interviewer.
        </p>
        <div className="hero-links">
          <a className="button button-primary button-huge" href={SIGN_UP_URL}>Sign up and start</a>
          <a className="text-link" href="#example">Try the example</a>
        </div>
      </div>
    </section>
  )
}

function Limits() {
  return (
    <section className="limits" aria-labelledby="limits-title">
      <h2 id="limits-title">What it won’t do.</h2>
      <dl className="limits-list">
        <div>
          <dt>Make things up.</dt>
          <dd>It writes only from your library and your answers, and checks drafts for claims they don’t support. Read every draft anyway, because a check can miss something.</dd>
        </div>
        <div>
          <dt>Send 500 applications.</dt>
          <dd>It never applies for you. It’s built for fewer, better applications, and you decide what goes out.</dd>
        </div>
        <div>
          <dt>Promise you a job.</dt>
          <dd>AI gets things wrong, so everything it writes is a draft for you to check. The hiring decision stays with the hiring team.</dd>
        </div>
      </dl>
      <div className="honest-note">
        <h3>How the AI is kept honest</h3>
        <p>
          Writing is checked for unsupported claims and retried when a check fails. Text from
          postings and uploads is screened for hidden instructions before it reaches a model.
          Prompts and models are tested against labelled, made-up examples, and every run is traced.
          These checks reduce mistakes rather than remove them, which is why you review the result.
        </p>
      </div>
    </section>
  )
}

function Close() {
  return (
    <section className="close" aria-labelledby="close-title">
      <h2 id="close-title">Start with the job you want most.</h2>
      <p className="close-value">Your experience, ready to reuse. A resume you control. Practice for the interview ahead.</p>
      <div className="close-arrival">
        <span className="close-track" aria-hidden><span className="close-terminal" /></span>
        <a className="button button-inverse button-huge" href={SIGN_UP_URL}>Sign up and start</a>
      </div>
    </section>
  )
}

function App() {
  const [gapAnswered, setGapAnswered] = useState(false)

  return (
    <>
      <a className="skip-link" href="#library">Skip to how it works</a>
      <header className="band">
        <a className="brand" href="#top" aria-label="Careergrind, back to top">
          <span className="brand-bullet" aria-hidden />
          Careergrind
        </a>
        <nav className="band-links" aria-label="Main">
          <a className="band-link band-link-optional" href="#library">How it works</a>
          <a className="band-link" href={SIGN_IN_URL}>Sign in</a>
          <a className="button button-inverse" href={SIGN_UP_URL}>Sign up</a>
        </nav>
      </header>
      <LineStrip gapNeedsAnswer={!gapAnswered} />
      <main id="top">
        <Hero />
        <ExamplePreview gapAnswered={gapAnswered} onToggleGapAnswer={() => setGapAnswered((answered) => !answered)} />
        <LibraryStop />
        <JobStop />
        <GapsStop gapAnswered={gapAnswered} onToggleGapAnswer={() => setGapAnswered((answered) => !answered)} />
        <ResumeStop gapAnswered={gapAnswered} />
        <InterviewStop />
        <SearchMap />
        <Limits />
        <Close />
      </main>
      <footer className="footer">
        <p>Careergrind</p>
        <p>Maya Okafor, her jobs and every company on this page are made up.</p>
        <nav aria-label="Footer">
          <a href={SIGN_IN_URL}>Sign in</a>
          <a href={PRIVACY_URL}>Privacy</a>
          <a href={TERMS_URL}>Terms</a>
        </nav>
      </footer>
    </>
  )
}

export default App
