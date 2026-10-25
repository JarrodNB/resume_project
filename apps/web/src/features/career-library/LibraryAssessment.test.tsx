/** Reviews guide editing with text as well as color, including stale and unreviewed text. */
import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { LibraryAssessment } from './LibraryAssessment'

it('explains a current color and replaces stale grades with a review prompt', () => {
  const assessment = { kind: 'experience_highlight', recordId: 'h1', field: 'content', color: 'red', reason: 'Explain your contribution.', stale: false }
  const { rerender } = render(<LibraryAssessment assessment={assessment} />)
  expect(screen.getByText('Needs work')).toBeInTheDocument()
  expect(screen.getByText('Explain your contribution.')).toBeInTheDocument()
  rerender(<LibraryAssessment assessment={{ ...assessment, stale: true }} />)
  expect(screen.getByText('Needs review')).toBeInTheDocument()
  expect(screen.queryByText('Needs work')).not.toBeInTheDocument()
  rerender(<LibraryAssessment />)
  expect(screen.getByText('Not reviewed')).toBeInTheDocument()
})

it('shows a saved review question beside the detail and hides it when its assessment is stale', () => {
  const assessment = { kind: 'experience_highlight', recordId: 'h1', field: 'content', color: 'yellow', reason: 'Explain your contribution.', stale: false,
    question: 'What did you personally do during the migration?' }
  const { rerender } = render(<LibraryAssessment assessment={assessment} compact />)
  expect(screen.getByText(assessment.question)).toBeInTheDocument()
  rerender(<LibraryAssessment assessment={{ ...assessment, stale: true }} compact />)
  expect(screen.queryByText(assessment.question)).not.toBeInTheDocument()
})

it('shows all saved questions together without repeating the legacy first question', () => {
  const questions = ['What did you personally do?', 'How did you approach it?', 'What changed afterward, if anything?']
  const assessment = { kind: 'experience_highlight', recordId: 'h1', field: 'content', color: 'yellow', reason: 'Add useful details.', stale: false,
    questions, question: questions[0] }
  const { rerender } = render(<LibraryAssessment assessment={assessment} compact />)
  questions.forEach((question) => expect(screen.getAllByText(question)).toHaveLength(1))
  rerender(<LibraryAssessment assessment={{ ...assessment, stale: true }} compact />)
  questions.forEach((question) => expect(screen.queryByText(question)).not.toBeInTheDocument())
})
