/** The made-up person and job the landing page rides through its stops.
 * Everything here is sample content written for this page. Nothing comes from a real user,
 * and the page labels it as made up wherever a visitor could mistake it for the real thing.
 */

export const LINE_STOPS = [
  { id: 'library', label: 'Library' },
  { id: 'job', label: 'Job' },
  { id: 'gaps', label: 'Gaps' },
  { id: 'resume', label: 'Resume' },
  { id: 'interview', label: 'Interview' },
] as const

export const PERSON_NAME = 'Maya Okafor'
export const TARGET_JOB = { title: 'Product Analyst', company: 'Fernhill Health' }
export const JOB_POSTING_URL = 'fernhillhealth.example/careers/product-analyst'

export const LIBRARY_ROLES = [
  {
    title: 'Support Analyst',
    company: 'Tallow Books',
    dates: '2022 to now',
    current: true,
    details: [
      'Built the weekly churn report in SQL, so support could see accounts at risk',
      'Wrote the guide new analysts use to read the numbers',
    ],
  },
  {
    title: 'Customer Support Lead',
    company: 'Tallow Books',
    dates: '2019 to 2022',
    current: false,
    details: ['Ran 40 customer calls to learn why people cancelled, then wrote up the top reasons'],
  },
]

export const LIBRARY_CONTEXT_NOTE =
  'Career context: notes that help the writing but never print on a resume.'

export const JOB_REQUIREMENTS = [
  'Strong SQL',
  'Comfortable building dashboards',
  'Talks to customers directly',
  'Presents findings to senior leaders',
]

export type RequirementVerdict = 'met' | 'partial' | 'missing'

export const GAP_ROWS: { requirement: string; evidence: string; verdict: RequirementVerdict }[] = [
  {
    requirement: 'Strong SQL',
    evidence: 'Built the weekly churn report in SQL',
    verdict: 'met',
  },
  {
    requirement: 'Comfortable building dashboards',
    evidence: 'A report, but nothing yet about a dashboard',
    verdict: 'partial',
  },
  {
    requirement: 'Talks to customers directly',
    evidence: 'Ran 40 customer calls to learn why people cancelled',
    verdict: 'met',
  },
]

export const OPEN_GAP = {
  requirement: 'Presents findings to senior leaders',
  question: 'Have you ever shared your findings with senior leaders? What happened?',
  answer: 'Yes. Every quarter I walk the VP of Support through the churn review.',
}

export const RESUME_LINES = [
  {
    text: 'Built a weekly churn report in SQL so the support team could see accounts at risk.',
    source: 'Her library: Tallow Books, churn report',
  },
  {
    text: 'Ran 40 customer calls to learn why people cancelled, then wrote up the top reasons.',
    source: 'Her library: Tallow Books, customer calls',
  },
]

export const ANSWERED_RESUME_LINE = {
  text: 'Present the churn review to the VP of Support every quarter.',
  source: 'Her answer to the gap question',
}

export const INTERVIEW_EXAMPLE = {
  question: 'Tell me about a time your numbers changed what a team did.',
  answer:
    'The churn report showed most cancellations came in the first month, so support moved its check-in calls earlier.',
  goodPoint: 'Clear link from the numbers to what the team changed.',
  improvePoint: 'Say what happened after the calls moved. If you do not know yet, say that.',
}

export type StageName = 'Saved' | 'Applied' | 'Interviewing' | 'Offer' | 'Rejected'
export type NextStepSignal = 'action' | 'ai' | 'wait' | 'done' | 'closed'

export const MAP_STATIONS: { name: StageName; jobs: { title: string; company: string; signal: NextStepSignal; next: string }[] }[] = [
  {
    name: 'Saved',
    jobs: [
      { title: 'Product Analyst', company: 'Fernhill Health', signal: 'action', next: 'Review resume draft' },
      { title: 'Data Analyst', company: 'Northgate Rail', signal: 'ai', next: 'Writing resume draft' },
    ],
  },
  {
    name: 'Applied',
    jobs: [{ title: 'Insights Analyst', company: 'Marlow & Pike', signal: 'wait', next: 'Waiting to hear back' }],
  },
  {
    name: 'Interviewing',
    jobs: [{ title: 'Support Ops Analyst', company: 'Brightwell', signal: 'action', next: 'Practice for the interview' }],
  },
  {
    name: 'Offer',
    jobs: [{ title: 'Revenue Analyst', company: 'Oakline', signal: 'done', next: 'Offer received' }],
  },
  {
    name: 'Rejected',
    jobs: [{ title: 'BI Analyst', company: 'Quillon', signal: 'closed', next: 'Closed' }],
  },
]

export const SIGNAL_LEGEND = [
  { signal: 'action', label: 'Needs you' },
  { signal: 'ai', label: 'AI working' },
  { signal: 'wait', label: 'Waiting on someone else' },
  { signal: 'done', label: 'Offer or success' },
] as const
