/** Checks Home's stage line, "Do next" list, AI work in progress, and the first-run guide that leads until the first tailored resume. */
import { screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { AI_TASK_UPDATED_SUBSCRIPTION } from '@/features/ai-tasks/aiTaskOperations'
import { CAREER_LIBRARY_QUERY } from '@/features/career-library/careerLibraryOperations'
import { LIBRARY_REVIEW_QUERY } from '@/features/career-library/libraryReviewOperations'
import { RESUMES_QUERY } from '@/features/resumes/resumesOperations'
import { INTERVIEW_QUESTION_BANK_QUERY } from '@/features/interview-prep/interviewPrepOperations'
import { RECENT_INTERVIEWS } from '@/features/interviews/interviewOperations'
import { JOB_PIPELINE_QUERY, RUNNING_AI_TASKS_QUERY } from './homeOperations'
import { DO_NEXT_LIMIT, HomePage } from './HomePage'

afterEach(() => localStorage.clear())

function entry(id: string, title: string, stage: string, nextStep: string) {
  return { __typename: 'JobPipelineEntry' as const, nextStep, job: { __typename: 'Job' as const, id, title, company: 'Synthetic Co', location: 'Remote', stage, createdAt: '2026-10-01T00:00:00Z', appliedAt: null } }
}

const pipeline = [
  entry('job-1', 'Platform Engineer', 'UNAPPLIED', 'WRITE_RESUME'),
  entry('job-2', 'Data Analyst', 'UNAPPLIED', 'RESUME_RUNNING'),
  entry('job-3', 'Site Reliability Engineer', 'APPLIED', 'AWAITING_RESPONSE'),
  entry('job-4', 'Backend Developer', 'INTERVIEWING', 'PRACTICE_INTERVIEW'),
  entry('job-5', 'QA Lead', 'REJECTED', 'NONE'),
]

function runningTask(id: string, label: string, destination: string) {
  return { __typename: 'RunningAiTask' as const, id, label, destination }
}

function runningMock(runningAiTasks: unknown[]) {
  return { request: { query: RUNNING_AI_TASKS_QUERY }, result: { data: { runningAiTasks } } }
}

function taskUpdate(id: string, status: string) {
  return { request: { query: AI_TASK_UPDATED_SUBSCRIPTION, variables: { id } }, result: { data: { aiTaskUpdated: {
    __typename: 'AiTask' as const, id, taskType: 'TAILOR_RESUME', status, result: null, input: {}, pendingQuestions: [],
    errorMessage: null, acceptedAt: null, createdAt: '2026-10-01T00:00:00Z', job: null,
  } } } }
}

function libraryMock(skills: unknown[]) {
  const me = { __typename: 'User' as const, id: 'user-1', name: 'Jane', contactEmail: null, phone: null, location: null, links: [], summary: null }
  return { request: { query: CAREER_LIBRARY_QUERY }, result: { data: { me, experiences: [], projects: [], educations: [], certifications: [], skills, careerContexts: [] } } }
}

/** Practice data every Home render asks for; empty unless a test supplies some. */
function practiceMocks(questions: unknown[] = [], sessions: unknown[] = [], resumes: unknown[] = []) {
  return [
    { request: { query: INTERVIEW_QUESTION_BANK_QUERY }, maxUsageCount: Infinity, result: { data: { interviewQuestions: questions } } },
    { request: { query: RECENT_INTERVIEWS }, maxUsageCount: Infinity, result: { data: { recentInterviewSessions: sessions } } },
    { request: { query: RESUMES_QUERY }, maxUsageCount: Infinity, result: { data: { resumes } } },
    ...['summary', 'experience', 'projects', 'career_contexts'].map((section) => (
      { request: { query: LIBRARY_REVIEW_QUERY, variables: { section } }, maxUsageCount: Infinity, result: { data: { libraryReview: { __typename: 'LibraryReview', aiTask: null, assessments: [] } } } }
    )),
  ]
}

/** One saved tailored resume, which moves Home past the first-run guide. */
const writtenResume = { __typename: 'Resume' as const, id: 'resume-1', title: 'Platform Engineer resume', updatedAt: '2026-10-02T00:00:00Z', job: { __typename: 'Job' as const, id: 'job-1', title: 'Platform Engineer', company: 'Synthetic Co' } }

function renderHome(jobPipeline: unknown[], runningAiTasks: unknown[] = [], skills: unknown[] = [{ __typename: 'Skill', id: 'skill-1', name: 'Ruby', category: null, position: 1 }], practice = practiceMocks()) {
  return renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline } } },
    runningMock(runningAiTasks),
    libraryMock(skills),
    ...practice,
  ] })
}

it('lists the application steps that need you, furthest along first, each linking to the right job tab', async () => {
  const jobs = [...pipeline, entry('job-7', 'Release Manager', 'APPLIED', 'READY_TO_APPLY')]
  renderHome(jobs)
  const doNext = await screen.findByRole('region', { name: 'Do next' })
  expect(within(doNext).getByText('2 jobs need you')).toBeInTheDocument()
  const rows = within(doNext).getAllByRole('listitem')
  expect(rows.map((row) => within(row).getByRole('heading', { level: 3 }).textContent)).toEqual(['Release Manager', 'Platform Engineer'])
  expect(within(doNext).getByRole('link', { name: 'Ready to apply: Release Manager' })).toHaveAttribute('href', '/jobs/job-7/posting')
  // Interview practice has its own lane, so it is not repeated here.
  expect(within(doNext).queryByText('Backend Developer')).not.toBeInTheDocument()
  expect(within(doNext).getByRole('link', { name: 'Write resume: Platform Engineer' })).toHaveAttribute('href', '/jobs/job-1/resume')
  expect(within(doNext).getByRole('link', { name: 'Platform Engineer' })).toHaveAttribute('href', '/jobs/job-1')
  // Waiting, AI-working and closed jobs are not asking anything of the user.
  expect(within(doNext).queryByText('Data Analyst')).not.toBeInTheDocument()
  expect(within(doNext).queryByText('Site Reliability Engineer')).not.toBeInTheDocument()
})

it('shows a stage line whose stations count jobs and open the Jobs list for that stage', async () => {
  renderHome(pipeline)
  const line = await screen.findByRole('navigation', { name: 'Jobs by stage' })
  expect(within(line).getByRole('link', { name: 'Not applied, 2 jobs' })).toHaveAttribute('href', '/jobs?stage=UNAPPLIED')
  expect(within(line).getByRole('link', { name: 'Applied, 1 job' })).toHaveAttribute('href', '/jobs?stage=APPLIED')
  expect(within(line).getByRole('link', { name: 'Offer, 0 jobs' })).toHaveAttribute('href', '/jobs?stage=OFFER')
  expect(within(line).getByRole('link', { name: 'Rejected, 1 job' })).toHaveAttribute('href', '/jobs?stage=REJECTED')
})

it('keeps Home short with many jobs: the stage line counts them all, Do next lists a few', async () => {
  const many = Array.from({ length: 40 }, (_, index) => entry(`job-${index}`, `Role ${index}`, 'UNAPPLIED', 'WRITE_RESUME'))
  renderHome(many, [], undefined, practiceMocks([], [], [writtenResume]))
  const doNext = await screen.findByRole('region', { name: 'Do next' })
  expect(within(doNext).getAllByRole('listitem')).toHaveLength(DO_NEXT_LIMIT)
  expect(within(doNext).getByText('40 jobs need you')).toBeInTheDocument()
  expect(within(doNext).getByRole('link', { name: 'See all 40 jobs' })).toHaveAttribute('href', '/jobs')
  expect(within(screen.getByRole('navigation', { name: 'Jobs by stage' })).getByRole('link', { name: 'Not applied, 40 jobs' })).toBeInTheDocument()
  expect(screen.queryByRole('group', { name: /, draggable$/ })).not.toBeInTheDocument()
})

it('shows applications, practice, library health and the week as four lanes', async () => {
  renderHome(pipeline)
  for (const name of ['Do next', 'Practice', 'Library', 'This week']) expect(await screen.findByRole('region', { name })).toBeInTheDocument()
})

it('leaves out the Library lane while the library is empty and points at importing instead', async () => {
  renderHome(pipeline, [], [])
  await screen.findByRole('complementary', { name: 'Your career library is empty' })
  expect(screen.queryByRole('region', { name: 'Library' })).not.toBeInTheDocument()
})

it('says the user is caught up when no application step needs them', async () => {
  renderHome([entry('job-3', 'Site Reliability Engineer', 'APPLIED', 'AWAITING_RESPONSE')])
  const doNext = await screen.findByRole('region', { name: 'Do next' })
  expect(within(doNext).getByText('You’re caught up.')).toBeInTheDocument()
  expect(within(doNext).queryByRole('list')).not.toBeInTheDocument()
  expect(within(doNext).getByRole('link', { name: 'Open all jobs' })).toHaveAttribute('href', '/jobs')
})

it('lists every kind of running AI work in the strip, each linked to its page', async () => {
  renderHome(pipeline, [
    runningTask('task-1', 'Resume draft: Data Analyst', '/jobs/job-2/resume'),
    runningTask('task-2', 'Resume import', '/library/import/task-2'),
  ])
  const running = await screen.findByRole('region', { name: 'AI work in progress' })
  expect(await within(running).findByRole('link', { name: 'Resume draft: Data Analyst' })).toHaveAttribute('href', '/jobs/job-2/resume')
  expect(within(running).getByRole('link', { name: 'Resume import' })).toHaveAttribute('href', '/library/import/task-2')
  expect(within(running).queryByText('Platform Engineer')).not.toBeInTheDocument()
})

it('reloads the strip and the next steps when a running task reports it finished, without polling', async () => {
  renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline: [entry('job-2', 'Data Analyst', 'UNAPPLIED', 'RESUME_RUNNING')] } } },
    runningMock([runningTask('task-1', 'Resume draft: Data Analyst', '/jobs/job-2/resume')]),
    ...practiceMocks([], [], [writtenResume]),
    taskUpdate('task-1', 'COMPLETED'),
    runningMock([]),
    { request: { query: JOB_PIPELINE_QUERY }, result: { data: { jobPipeline: [entry('job-2', 'Data Analyst', 'UNAPPLIED', 'REVIEW_RESUME_DRAFT')] } } },
  ] })
  const running = await screen.findByRole('region', { name: 'AI work in progress' })
  expect(await within(running).findByText('Nothing running right now')).toBeInTheDocument()
  await waitFor(() => expect(screen.getByRole('link', { name: 'Review resume draft: Data Analyst' })).toBeInTheDocument())
})

it('shows the four starting steps before any job is saved, with every way to save a job', async () => {
  renderHome([], [], [])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in four steps' })
  expect(within(firstRun).getByRole('link', { name: 'Import a resume' })).toHaveAttribute('href', '/library')
  expect(within(firstRun).getByRole('link', { name: 'Find jobs' })).toHaveAttribute('href', '/jobs/find')
  expect(within(firstRun).getByRole('link', { name: 'Paste a job ad' })).toHaveAttribute('href', '/jobs/paste')
  expect(within(firstRun).getByRole('link', { name: 'Add a posting link' })).toHaveAttribute('href', '/jobs/new')
  expect(within(firstRun).getByRole('heading', { name: 'Prepare for the interview' })).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Jobs by stage' })).not.toBeInTheDocument()
})

it('lets the guide lead: the header has no competing buttons while the guide shows', async () => {
  renderHome([], [], [])
  await screen.findByRole('region', { name: 'Start your search in four steps' })
  expect(screen.queryByRole('link', { name: 'Add a job' })).not.toBeInTheDocument()
  // Only the current step's action is a button-styled link; the rest are quiet links.
  expect(screen.getByRole('link', { name: 'Import a resume' })).toHaveAttribute('data-slot', 'button')
  expect(screen.getByRole('link', { name: 'Find jobs' })).not.toHaveAttribute('data-slot')
})

it('keeps the guide after a job is saved, until a tailored resume is written, linking step 3 to the job', async () => {
  renderHome([entry('job-1', 'Platform Engineer', 'UNAPPLIED', 'COMPARE')])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in four steps' })
  expect(await within(firstRun).findByRole('link', { name: 'Review your library' })).toBeInTheDocument()
  expect(within(firstRun).getByRole('heading', { name: /^Save a job you want\s*\(done\)$/ })).toBeInTheDocument()
  expect(within(firstRun).getByText('Platform Engineer at Synthetic Co')).toBeInTheDocument()
  const compare = within(firstRun).getByRole('heading', { name: 'Compare, then write' }).closest('li')!
  expect(compare).toHaveAttribute('aria-current', 'step')
  expect(within(compare).getByRole('link', { name: 'Compare with library' })).toHaveAttribute('href', '/jobs/job-1')
  expect(screen.queryByRole('region', { name: 'Do next' })).not.toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Add a job' })).not.toBeInTheDocument()
})

it('points step 3 at the resume tab once the job has been compared', async () => {
  renderHome([entry('job-1', 'Platform Engineer', 'UNAPPLIED', 'WRITE_RESUME')])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in four steps' })
  expect(within(firstRun).getByRole('link', { name: 'Write resume' })).toHaveAttribute('href', '/jobs/job-1/resume')
})

it('keeps import as the current step when a job is saved but the library is empty', async () => {
  renderHome([entry('job-1', 'Platform Engineer', 'UNAPPLIED', 'COMPARE')], [], [])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in four steps' })
  await waitFor(() => expect(within(firstRun).getByRole('heading', { name: 'Fill your career library' }).closest('li')).toHaveAttribute('aria-current', 'step'))
  expect(within(firstRun).getByRole('link', { name: 'Compare with library' })).not.toHaveAttribute('data-slot')
})

it('switches to the dashboard once a tailored resume exists', async () => {
  renderHome([entry('job-1', 'Platform Engineer', 'UNAPPLIED', 'READY_TO_APPLY')], [], undefined, practiceMocks([], [], [writtenResume]))
  expect(await screen.findByRole('region', { name: 'Do next' })).toBeInTheDocument()
  expect(screen.queryByRole('region', { name: 'Start your search in four steps' })).not.toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Add a job' })).toHaveAttribute('href', '/jobs/new')
})

it('marks the library step done and points at saving a job once the library has content', async () => {
  renderHome([])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in four steps' })
  expect(await within(firstRun).findByRole('link', { name: 'Review your library' })).toHaveAttribute('href', '/library')
  expect(within(firstRun).queryByRole('link', { name: 'Import a resume' })).not.toBeInTheDocument()
  expect(within(firstRun).getByRole('heading', { name: 'Save a job you want' }).closest('li')).toHaveAttribute('aria-current', 'step')
})

it('keeps the import step current while the library is empty', async () => {
  renderHome([], [], [])
  const firstRun = await screen.findByRole('region', { name: 'Start your search in four steps' })
  expect(await within(firstRun).findByRole('link', { name: 'Import a resume' })).toBeInTheDocument()
  expect(within(firstRun).getByRole('heading', { name: 'Fill your career library' }).closest('li')).toHaveAttribute('aria-current', 'step')
})

it('tells a user with saved jobs and an empty library to fill the library first', async () => {
  renderHome(pipeline, [], [])
  const note = await screen.findByRole('complementary', { name: 'Your career library is empty' })
  expect(within(note).getByRole('link', { name: 'Import a resume' })).toHaveAttribute('href', '/library')
})

it('explains a load failure and offers to try again', async () => {
  renderPage({ path: '/', url: '/', element: <HomePage />, mocks: [{ request: { query: JOB_PIPELINE_QUERY }, error: new Error('Network down') }, runningMock([]), ...practiceMocks()] })
  expect(await screen.findByText("Couldn't load your jobs")).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
})

it('says when no AI work is running and explains the signal colors', async () => {
  renderHome([entry('job-6', 'Analytics Engineer', 'OFFER', 'NONE')])
  expect(await within(await screen.findByRole('region', { name: 'AI work in progress' })).findByText('Nothing running right now')).toBeInTheDocument()
  expect(within(screen.getByRole('list', { name: 'Signal colors' })).getByText('Needs you')).toBeInTheDocument()
})
