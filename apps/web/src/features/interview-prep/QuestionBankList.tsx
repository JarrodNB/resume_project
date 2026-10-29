/**
 * Description: The question bank: every current practice question with its answer progress.
 * Filters by progress and type and searches question and answer text in the browser.
 * Each row opens that question inside its set. Read-only; editing happens on the set page.
 */
import { useState } from 'react'
import { Link } from 'react-router'
import { ChevronRight } from 'lucide-react'
import type { InterviewQuestionBankQuery, InterviewQuestionSetTypeEnum } from '@/graphql/generated/graphql'
import { Input } from '@/components/ui/input'
import { interviewSetDate } from './interviewSetDate'
import { interviewSetTypeLabel } from './interviewSetTypeLabel'
import { PROGRESS_LABELS, matchesFilter, questionProgress, type QuestionFilter } from './questionProgress'
import { QuestionProgressMark } from './QuestionProgressMark'

type BankQuestion = InterviewQuestionBankQuery['interviewQuestions'][number]

const FILTERS: { value: QuestionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'todo', label: 'To answer' },
  { value: 'feedback', label: 'Needs feedback' },
  { value: 'ready', label: 'Feedback ready' },
]

/** Lists current questions with progress filters, a type filter, and text search. */
export function QuestionBankList({ questions }: { questions: BankQuestion[] }) {
  const [filter, setFilter] = useState<QuestionFilter>('all')
  const [setType, setSetType] = useState<InterviewQuestionSetTypeEnum | 'ALL'>('ALL')
  const [search, setSearch] = useState('')
  const rows = questions.map((question) => ({ question, progress: questionProgress(question) }))
  const typed = rows.filter(({ question }) => setType === 'ALL' || question.questionSet.setType === setType)
  const term = search.trim().toLowerCase()
  const visible = typed.filter(({ question, progress }) => matchesFilter(progress, filter) &&
    (!term || question.questionText.toLowerCase().includes(term) || question.answerText.toLowerCase().includes(term)))

  return <section className="question-bank" aria-labelledby="question-bank-heading">
    <div className="question-bank-toolbar">
      <h2 id="question-bank-heading">Your questions</h2>
      <div className="question-bank-search">
        <label className="sr-only" htmlFor="question-bank-type">Filter by type</label>
        <select id="question-bank-type" className="question-bank-select" value={setType} onChange={(event) => setSetType(event.target.value as InterviewQuestionSetTypeEnum | 'ALL')}>
          <option value="ALL">All types</option>
          <option value="GENERAL">General</option>
          <option value="TECHNICAL">Technical</option>
          <option value="KNOWLEDGE">Knowledge</option>
        </select>
        <Input type="search" aria-label="Search questions and answers" placeholder="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>
    </div>
    <div className="question-filters" role="group" aria-label="Show questions">
      {FILTERS.map(({ value, label }) => <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
        {label}<span className="question-filter-count">{typed.filter(({ progress }) => matchesFilter(progress, value)).length}</span>
      </button>)}
    </div>
    {visible.length === 0
      ? <p className="question-bank-none">No questions match these filters.</p>
      : <ul className="record-list">
        {visible.map(({ question, progress }) => <li key={question.id}>
          <Link className="question-row" to={`/practice/questions/${question.questionSet.id}/${question.id}`}>
            <QuestionProgressMark progress={progress} />
            <span className="question-row-text">
              <span className="question-row-title">{question.questionText}</span>
              <span className="question-row-meta">{PROGRESS_LABELS[progress]} · {interviewSetTypeLabel(question.questionSet.setType)} · Set {question.questionSet.number} · {interviewSetDate(question.questionSet.createdAt)}</span>
              {question.answerText.trim() && <span className="question-row-answer">{question.answerText}</span>}
            </span>
            <ChevronRight className="record-arrow" aria-hidden="true" />
          </Link>
        </li>)}
      </ul>}
  </section>
}
