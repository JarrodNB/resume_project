/** Checks the saved report through its visible rubric and findings. */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { AtsReport } from './AtsReport'

it('explains scores and prioritizes findings without applying edits', async () => {
  render(<AtsReport resumeId="resume" dirty={false} report={{ runId: 'run', outdated: false, rubricVersion: 'ats-v1', overallScore: null,
    jobAlignment: { status: 'unavailable', score: null, reason: 'Job removed', assessments: [], deductions: [] },
    contentQuality: { status: 'completed', score: 80, reason: null, deductions: [{ key: 'dates', points: 20 }], assessments: [
      { key: 'dates', severity: 'error', explanation: 'Dates are missing.', suggested_action: 'Add your real dates.', evidence: [{ section_id: 'section', excerpt: 'Engineer' }] },
    ] }, pdfReadability: { status: 'awaiting_export', score: null, reason: null, assessments: [], deductions: [] },
  }} pending={false} errors={[]} onRerun={() => {}} />)
  expect(screen.queryByText('Dates are missing.')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /ATS check/ }))
  expect(screen.getByText(/not an employer/)).toBeInTheDocument()
  expect(screen.getByText('Dates are missing.')).toBeInTheDocument()
  expect(screen.getByText('Add your real dates.')).toBeInTheDocument()
  expect(screen.getByText(/Awaiting PDF export/)).toBeInTheDocument()
  expect(screen.getByText(/Overall score: pending/)).toBeInTheDocument()
})

it('keeps the content score current when only job alignment is outdated', async () => {
  const category = { status: 'completed', score: 80, reason: null, assessments: [], deductions: [] }
  render(<AtsReport resumeId="job-change" dirty={false} report={{ runId: 'run', outdated: true, rubricVersion: 'ats-v1', overallScore: null,
    jobAlignment: { ...category, status: 'outdated', score: null }, contentQuality: category,
    pdfReadability: { ...category, status: 'awaiting_export', score: null },
  }} pending={false} errors={[]} onRerun={() => {}} />)
  await userEvent.click(screen.getByRole('button', { name: /ATS check/ }))
  expect(screen.getByText('Content quality: completed — 80/100')).toBeInTheDocument()
})
