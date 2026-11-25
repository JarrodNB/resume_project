/** Home's Library lane: how healthy the career library is, and the one step that improves it.
 *
 * Shows what the library holds, a bar of how its reviewable details graded (good, could improve,
 * needs work, not reviewed), and the next step (answer a review question, fix a weak detail, run a
 * review). It reads saved section reviews only; reviewing and editing happen on the Library page.
 * Shown once the library has content. If the reviews cannot load it still shows the counts.
 */
import { useQuery } from '@apollo/client/react'
import { Link } from 'react-router'
import { ArrowRight } from 'lucide-react'
import { LIBRARY_REVIEW_QUERY } from '@/features/career-library/libraryReviewOperations'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { libraryHealth, type LibraryHealth, type ReviewsBySection, type SectionReview } from './libraryHealth'
import { SignalDot } from './NextStepSignal'

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

/** "3 roles · 2 projects · 12 skills", leaving out what is empty. */
function libraryContents(library: CareerLibraryQuery) {
  return [
    library.experiences.length && plural(library.experiences.length, 'role'),
    library.projects.length && plural(library.projects.length, 'project'),
    library.skills.length && plural(library.skills.length, 'skill'),
  ].filter(Boolean).join(' · ')
}

export function LibraryHealthPanel({ library }: { library: CareerLibraryQuery }) {
  const options = { fetchPolicy: 'cache-and-network' as const }
  const summary = useQuery(LIBRARY_REVIEW_QUERY, { ...options, variables: { section: 'summary' } })
  const experience = useQuery(LIBRARY_REVIEW_QUERY, { ...options, variables: { section: 'experience' } })
  const projects = useQuery(LIBRARY_REVIEW_QUERY, { ...options, variables: { section: 'projects' } })
  const careerContexts = useQuery(LIBRARY_REVIEW_QUERY, { ...options, variables: { section: 'career_contexts' } })
  const results = [summary, experience, projects, careerContexts]
  const loaded = results.every((result) => result.data)
  const failed = !loaded && results.some((result) => result.error)
  const section = (result: (typeof results)[number]): SectionReview => ({
    aiTaskStatus: result.data?.libraryReview.aiTask?.status, assessments: result.data?.libraryReview.assessments ?? [],
  })
  const reviews: ReviewsBySection = { summary: section(summary), experience: section(experience), projects: section(projects), career_contexts: section(careerContexts) }
  const health = loaded ? libraryHealth(library, reviews) : null

  return (
    <section className="home-lane" aria-labelledby="library-health-heading">
      <div className="lane-head"><h2 id="library-health-heading">Library</h2><span>{libraryContents(library)}</span></div>
      {health && <HealthSummary health={health} />}
      {failed && <p className="lane-quiet">Couldn’t load your library reviews. <Link to="/library">Open your library</Link> to see them there.</p>}
      <Link to="/library" className="lane-all">Open your library <ArrowRight aria-hidden /></Link>
    </section>
  )
}

function HealthSummary({ health }: { health: LibraryHealth }) {
  const parts = [
    { key: 'good', count: health.good, label: 'look good', dot: 'is-done' },
    { key: 'improve', count: health.improvable, label: 'could improve', dot: 'is-partial' },
    { key: 'weak', count: health.weak, label: 'need work', dot: 'is-action' },
    { key: 'none', count: health.unreviewed, label: 'not reviewed', dot: 'is-off' },
  ]
  const summary = parts.filter((part) => part.count > 0).map((part) => `${part.count} ${part.label}`).join(', ')
  const { step } = health
  return (
    <>
      {health.total > 0 && (
        <>
          <div className="health-bar" role="img" aria-label={`${plural(health.total, 'reviewable detail')}: ${summary}`}>
            {parts.filter((part) => part.count > 0).map((part) => <span key={part.key} className={`health-${part.key}`} style={{ flexGrow: part.count }} />)}
          </div>
          <ul className="health-legend" aria-hidden>
            {parts.filter((part) => part.count > 0).map((part) => <li key={part.key}><span className={`signal-dot ${part.dot}`} />{part.count} {part.label}</li>)}
          </ul>
        </>
      )}
      <ul>
        <li className="pipeline-row">
          <div className="pipeline-job"><h3>{step.label}</h3><p>{step.detail}</p></div>
          <Link to="/library" className={step.signal === 'done' || step.signal === null ? 'next-step is-quiet' : 'next-step'} aria-label={`${step.label}: your library`}>
            {step.signal && <SignalDot signal={step.signal} />}Open library
          </Link>
        </li>
      </ul>
    </>
  )
}
