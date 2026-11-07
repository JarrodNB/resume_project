/**
 * Keeps a finished comparison honest after answers are saved, edited, cleared, or loaded again.
 * Saved details move a requirement to Answered without awarding it a new AI verdict.
 */
import { MockedProvider } from '@apollo/client/testing/react'
import { render, screen, within } from '@testing-library/react'
import { expect, it } from 'vitest'
import { GapAnalysisResultView } from './GapAnalysisResultView'
import type { GapAnalysisResult } from './parseGapAnalysisResult'
import type { SavedGapResponse } from './savedGapResponse'

const requirement = 'Present findings to senior leaders'
const summary = 'Your library lacks evidence of presenting to senior leaders.'
const analysis: GapAnalysisResult = {
  summary,
  warnings: ['One unrelated note was left out.'],
  assessments: [{ kind: 'required', requirement, verdict: 'missing', explanation: 'No leadership presentations found.', evidence: [] }],
}
const answer: SavedGapResponse = {
  id: 'answer-1', requirement, body: 'Presented the monthly churn report to our VP at Acme.', careerContext: null,
}

function view(responses: SavedGapResponse[], result = analysis) {
  return (
    <MockedProvider>
      <GapAnalysisResultView jobId="job-1" analysis={result} responses={responses} dismissedRequirements={[]} comparedNote={<button>Compare again</button>} />
    </MockedProvider>
  )
}

it('replaces the summary after saving an answer, including edits and clearing', () => {
  const { rerender } = render(view([]))
  const summaryPanel = screen.getByRole('region', { name: 'Comparison summary' })
  expect(within(summaryPanel).getByText(summary)).toBeInTheDocument()
  expect(within(summaryPanel).getByText('1 gap')).toBeInTheDocument()

  rerender(view([answer]))
  expect(screen.queryByText(summary)).not.toBeInTheDocument()
  expect(within(summaryPanel).getByRole('status')).toHaveTextContent('Your saved answers are shown below')
  expect(within(summaryPanel).getByRole('button', { name: 'Compare again' })).toBeInTheDocument()
  expect(screen.getByRole('heading', { name: /Answered/ })).toBeInTheDocument()
  expect(screen.getByText('At the last comparison')).toBeInTheDocument()
  expect(screen.getByText('One unrelated note was left out.')).toBeInTheDocument()
  const row = screen.getByText(requirement).closest('li')!
  expect(within(row).getByText('Gap')).toBeInTheDocument()
  expect(within(row).getByText(answer.body)).toBeInTheDocument()

  rerender(view([{ ...answer, body: 'Presented to the CEO and VP at Acme.' }]))
  expect(screen.queryByText(summary)).not.toBeInTheDocument()
  expect(screen.getByText('Presented to the CEO and VP at Acme.')).toBeInTheDocument()

  rerender(view([]))
  expect(screen.getByText(summary)).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
  expect(screen.queryByText('At the last comparison')).not.toBeInTheDocument()
})

it('hides the summary for saved answers on the initial render after returning to Fit', () => {
  render(view([answer]))
  expect(screen.queryByText(summary)).not.toBeInTheDocument()
  expect(screen.getByText(answer.body)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Compare again' })).toBeInTheDocument()
})

it('also hides broad missing-evidence claims for partial and nice-to-have answers', () => {
  render(view([answer], { ...analysis, assessments: [{ ...analysis.assessments[0]!, kind: 'nice_to_have', verdict: 'partial' }] }))
  expect(screen.queryByText(summary)).not.toBeInTheDocument()
  expect(screen.getByRole('status')).toBeInTheDocument()
})

it('shows a later comparison summary when the answered requirement is met', () => {
  render(view([answer], {
    ...analysis,
    summary: 'Your library supports presenting to senior leaders.',
    assessments: [{ ...analysis.assessments[0]!, verdict: 'met' }],
  }))
  expect(screen.getByText('Your library supports presenting to senior leaders.')).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})

it('ignores answers whose requirement is absent from the comparison', () => {
  render(view([{ ...answer, requirement: 'An old requirement' }]))
  expect(screen.getByText(summary)).toBeInTheDocument()
  expect(screen.queryByRole('status')).not.toBeInTheDocument()
})
