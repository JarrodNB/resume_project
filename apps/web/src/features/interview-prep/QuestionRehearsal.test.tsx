/** Tests recalling saved answers through the bank without starting AI or saving progress. */
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { MockLink } from '@apollo/client/testing'
import type { InterviewQuestionBankQuery } from '@/graphql/generated/graphql'
import { renderPage } from '@/test/renderPage'
import { QuestionBankList } from './QuestionBankList'

afterEach(() => vi.restoreAllMocks())

function question(id: string, overrides: Partial<InterviewQuestionBankQuery['interviewQuestions'][number]> = {}): InterviewQuestionBankQuery['interviewQuestions'][number] {
  return { id, position: 1, retiredAt: null, questionText: `Question ${id}?`, memoryAnchor: '', answerText: `Saved answer ${id}`, feedback: {}, feedbackOutdated: false, latestTask: null,
    questionSet: { id: 'set', number: 1, setType: 'TECHNICAL', createdAt: '2026-10-12T00:00:00Z' }, ...overrides }
}
function bank(questions = [question('one', { memoryAnchor: 'Launch checklist' }), question('two')]) {
  return renderPage({ path: '/practice/questions', url: '/practice/questions', element: <QuestionBankList questions={questions} />,
    extraRoutes: [{ path: '/practice/questions/:id/:questionId', element: <p>Answer editor</p> }] })
}

it('practices saved answers in bank order and exposes an answer only after reveal', () => {
  bank()
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  expect(screen.getByRole('heading', { name: 'Question one?' })).toHaveFocus()
  expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 2')
  expect(screen.getByText('Launch checklist')).toBeInTheDocument()
  expect(screen.queryByText('Saved answer one')).not.toBeInTheDocument()
  expect(screen.queryByText('Saved answer two')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
  expect(screen.getByText('Saved answer one')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Hide answer' }))
  expect(screen.queryByText('Saved answer one')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  expect(screen.getByRole('heading', { name: 'Question two?' })).toHaveFocus()
  expect(screen.queryByText('Saved answer one')).not.toBeInTheDocument()
  expect(screen.queryByText('Saved answer two')).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
  expect(screen.queryByText('Saved answer one')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Return to question bank' }))
  expect(screen.getByRole('button', { name: 'Practice' })).toHaveFocus()
})

it('rehearses only saved active answers matching search and restores the search', () => {
  bank([question('selected', { memoryAnchor: 'Unique cue' }),
    question('unanswered', { answerText: '  ', memoryAnchor: 'No answer cue' }),
    question('retired', { retiredAt: '2026-10-13T00:00:00Z', memoryAnchor: 'Unique cue' }),
    question('other-search')])
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Unique cue' } })
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 1')
  expect(screen.getByRole('heading', { name: 'Question selected?' })).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Return to question bank' }))
  expect(screen.getByRole('searchbox')).toHaveValue('Unique cue')
  expect(screen.getByRole('button', { name: 'Practice' })).toHaveFocus()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'No answer cue' } })
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  expect(screen.getByRole('heading', { name: 'No answers to practice' })).toHaveFocus()
  expect(screen.queryByRole('button', { name: 'Reveal answer' })).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Return to question bank' }))
  expect(screen.getByRole('searchbox')).toHaveValue('No answer cue')
})

it('handles a bank with no questions', () => {
  bank([])
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  expect(screen.getByRole('heading', { name: 'No answers to practice' })).toBeVisible()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})


it('shuffles a complete pass without duplicate or missing questions and waits before reshuffling', () => {
  vi.spyOn(Math, 'random').mockReturnValue(0)
  bank([question('one'), question('two'), question('three')])
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
  fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
  expect(screen.queryByText(/Saved answer/)).not.toBeInTheDocument()
  const firstPass: string[] = []
  for (let index = 0; index < 3; index++) {
    firstPass.push(screen.getByRole('heading').textContent!)
    expect(screen.getByRole('status')).toHaveTextContent(`Question ${index + 1} of 3`)
    expect(screen.getByRole('button', { name: 'Shuffle' })).toHaveProperty('disabled', index < 2)
    if (index < 2) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }
  expect(firstPass).toEqual(['Question two?', 'Question three?', 'Question one?'])
  fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
  const secondPass: string[] = []
  for (let index = 0; index < 3; index++) {
    secondPass.push(screen.getByRole('heading').textContent!)
    if (index < 2) fireEvent.click(screen.getByRole('button', { name: 'Next' }))
  }
  expect(secondPass.sort()).toEqual(['Question one?', 'Question three?', 'Question two?'])
})

it('uses arrows outside editable fields, respects shortcuts, and supports native keyboard buttons', async () => {
  const user = userEvent.setup()
  bank()
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  const heading = screen.getByRole('heading')
  for (const modifier of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) {
    fireEvent.keyDown(heading, { key: 'ArrowRight', [modifier]: true })
    expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 2')
  }
  const region = screen.getByRole('region', { name: 'Question rehearsal' })
  for (const element of [document.createElement('input'), document.createElement('textarea'), document.createElement('select'), document.createElement('div')]) {
    if (element.tagName === 'DIV') element.setAttribute('contenteditable', 'true')
    region.appendChild(element)
    fireEvent.keyDown(element, { key: 'ArrowRight' })
    expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 2')
    element.remove()
  }
  screen.getByRole('button', { name: 'Reveal answer' }).focus()
  await user.keyboard('{Enter}')
  expect(screen.getByText('Saved answer one')).toBeVisible()
  await user.keyboard(' ')
  expect(screen.queryByText('Saved answer one')).not.toBeInTheDocument()
  await user.keyboard('{ArrowRight}')
  expect(screen.getByRole('heading', { name: 'Question two?' })).toHaveFocus()
  fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
  fireEvent.keyDown(screen.getByRole('heading'), { key: 'ArrowLeft' })
  expect(screen.getByRole('heading', { name: 'Question one?' })).toHaveFocus()
  expect(screen.queryByText('Saved answer two')).not.toBeInTheDocument()
})

it('keeps one-question rehearsal usable through reveal, shuffle and the existing edit route', async () => {
  const { router } = bank([question('only')])
  fireEvent.click(screen.getByRole('button', { name: 'Practice' }))
  fireEvent.click(screen.getByRole('button', { name: 'Reveal answer' }))
  expect(screen.getByText('Saved answer only')).toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Shuffle' }))
  expect(screen.queryByText('Saved answer only')).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 1')
  expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
  fireEvent.click(screen.getByRole('link', { name: 'Edit answer' }))
  expect(await screen.findByText('Answer editor')).toBeVisible()
  expect(router.state.location.pathname).toBe('/practice/questions/set/only')
})


it('rehearses without API requests or changes to saved answer progress', async () => {
  const requests = vi.spyOn(MockLink.prototype, 'request')
  const questions = [question('one'), question('two', { feedback: { strengths: ['Clear'] } })]
  const saved = structuredClone(questions)
  const user = userEvent.setup()
  bank(questions)
  await user.click(screen.getByRole('button', { name: 'Practice' }))
  await user.click(screen.getByRole('button', { name: 'Shuffle' }))
  await user.click(screen.getByRole('button', { name: 'Reveal answer' }))
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.click(screen.getByRole('button', { name: 'Reveal answer' }))
  await user.click(screen.getByRole('button', { name: 'Return to question bank' }))
  expect(screen.getByRole('button', { name: /^Question one/ })).toHaveTextContent('No feedback yet')
  expect(screen.getByRole('button', { name: /^Question two/ })).toHaveTextContent('Feedback ready')
  expect(questions).toEqual(saved)
  expect(requests).not.toHaveBeenCalled()
})

it('combines selected types and resets the pass without revealing answers', async () => {
  const user = userEvent.setup()
  bank([question('technical'), question('fit', { questionSet: { id: 'fit', number: 1, setType: 'FIT_MOTIVATION', createdAt: '2026-10-12T00:00:00Z' } }), question('blank', { answerText: ' ' })])
  await user.click(screen.getByRole('button', { name: 'Practice' }))
  await user.click(screen.getByRole('button', { name: 'Reveal answer' }))
  await user.click(screen.getByRole('button', { name: /Question types/ }))
  expect(screen.getByRole('checkbox', { name: 'Technical (1)' })).toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'Fit & motivation (1)' }))
  expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 2')
  expect(screen.queryByText(/Saved answer/)).not.toBeInTheDocument()
  await user.click(screen.getByRole('checkbox', { name: 'Technical (1)' }))
  expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 1')
  expect(screen.getByRole('heading', { name: 'Question fit?' })).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: 'Fit & motivation (1)' }))
  expect(screen.getByRole('heading', { name: 'No answers to practice' })).toBeVisible()
  await user.click(screen.getByRole('checkbox', { name: 'Technical (1)' }))
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'Shuffle' }))
  expect(screen.getByRole('status')).toHaveTextContent('Question 1 of 1')
})
