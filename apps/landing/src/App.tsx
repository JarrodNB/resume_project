/** The Careerdrafter landing page: what the product does, shown with one made-up job seeker, then sign-up.
 * Static and public. Its only state is the scripted gap answer in the worked example, and its
 * only ways out are links to the web app.
 */
import { useState } from 'react'
import { PRIVACY_URL, SIGN_IN_URL, SIGN_UP_URL, TERMS_URL } from './appLinks'
import { LineStrip } from './LineStrip'
import { GapsStop, InterviewStop, JobStop, LibraryStop, ResumeStop } from './RideStops'
import { SearchMap } from './SearchMap'

function Hero() {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <h1 id="hero-title">Stop sending the same resume everywhere.</h1>
      <p className="hero-lede">
        Careerdrafter keeps everything you’ve done in one place, then helps you write a resume for
        each job you really want. Nothing goes on the page that you can’t back up.
      </p>
      <div className="hero-links">
        <a className="button button-primary button-huge" href={SIGN_UP_URL}>Create your account</a>
        <a className="text-link" href="#library">See how it works</a>
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
          <dd>It only writes from what you’ve told it, and it checks drafts for claims you can’t back up. Still, read every line before you send it.</dd>
        </div>
        <div>
          <dt>Apply for you.</dt>
          <dd>It never sends anything. It’s for the handful of jobs you care about, not five hundred you don’t.</dd>
        </div>
        <div>
          <dt>Promise you a job.</dt>
          <dd>It helps you show up prepared. Who gets hired is still up to the people hiring.</dd>
        </div>
      </dl>
    </section>
  )
}

function Close() {
  return (
    <section className="close" aria-labelledby="close-title">
      <h2 id="close-title">Start with the job you want most.</h2>
      <p className="close-value">Add your experience once. Tailor it for every job. Practice before the interview.</p>
      <div className="close-arrival">
        <span className="close-track" aria-hidden><span className="close-terminal" /></span>
        <a className="button button-inverse button-huge" href={SIGN_UP_URL}>Create your account</a>
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
        <a className="brand" href="#top" aria-label="Careerdrafter, back to top">
          <span className="brand-bullet" aria-hidden />
          Careerdrafter
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
        <p>Careerdrafter</p>
        <p>Maya, her jobs and every company on this page are made up.</p>
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
