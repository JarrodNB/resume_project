/** Exercises draft freshness and saved-input reruns through GraphQL boundaries. */
import { act, render, screen, waitFor } from '@testing-library/react'
import { ApolloLink, Observable } from '@apollo/client'
import { MockedProvider } from '@apollo/client/testing/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { SavedResumeEditor } from './SavedResumeEditor'
import { ATS_REPORT_QUERY, ATS_REPORT_UPDATED_SUBSCRIPTION, RERUN_ATS_CHECK_MUTATION } from './atsOperations'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'
import type { AtsReportFieldsFragment } from '@/graphql/generated/graphql'

vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: () => <div>PDF preview</div> }))
const category: AtsReportFieldsFragment['contentQuality'] & { __typename: string } = { __typename: 'AtsCategory', status: 'queued', score: null, reason: null, assessments: [], deductions: [] }
const report: AtsReportFieldsFragment & { __typename: string } = { __typename: 'AtsReport', id: 'run', runId: 'run', contentFingerprint: 'content', jobFingerprint: 'job', rubricVersion: 'ats-v1', createdAt: '2026-10-17T00:00:00Z', outdated: false, overallScore: null, jobAlignment: category, contentQuality: category, pdfReadability: { ...category, status: 'awaiting_export' } }
export const sections = [{ id: 'section', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Engineer' } }]
export function atsMocks(value = report) { return [
  { request: { query: ATS_REPORT_QUERY, variables: { id: 'resume' } }, result: { data: { resume: { __typename: 'Resume', id: 'resume', atsReport: value } } } },
  { request: { query: ATS_REPORT_UPDATED_SUBSCRIPTION, variables: { resumeId: 'resume' } }, result: { data: { atsReportUpdated: value } } },
] }

it('marks feedback outdated immediately and restores freshness when the draft is reverted', async () => {
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="resume" sections={sections} />, mocks: atsMocks() })
  await userEvent.click(await screen.findByRole('button', { name: /ATS check/ }))
  const field = screen.getByRole('textbox', { name: 'Summary' })
  await userEvent.type(field, ' edited')
  expect(screen.getByText(/Unsaved edits make this feedback outdated/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: /Checking saved resume/ })).toBeDisabled()
  await userEvent.clear(field)
  await userEvent.type(field, 'Engineer')
  expect(screen.queryByText(/Unsaved edits make this feedback outdated/)).not.toBeInTheDocument()
})

const completed = { ...report, jobAlignment: { ...category, status: 'completed', score: 90 }, contentQuality: { ...category, status: 'completed', score: 80 } }

it('requires explicit saving before rerun and keeps save failures separate', async () => {
  const rerun = vi.fn(() => ({ data: { rerunResumeAtsCheck: { __typename: 'RerunResumeAtsCheckPayload', report: null, errors: ['Check allowance exhausted.'] } } }))
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="resume" sections={sections} />, mocks: [
    ...atsMocks(completed),
    { request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume', sections: [{ id: 'section', content: { text: 'Engineer edited' } }] } }, result: { data: { updateResume: { __typename: 'UpdateResumePayload', resume: null, errors: ['Save rejected.'] } } } },
    { request: { query: RERUN_ATS_CHECK_MUTATION, variables: { resumeId: 'resume' } }, result: rerun },
  ] })
  await userEvent.click(screen.getByRole('button', { name: /ATS check/ }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), ' edited')
  expect(screen.getByRole('button', { name: 'Rerun content check' })).toBeDisabled()
  await userEvent.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByText('Save rejected.')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Engineer edited')
  expect(rerun).not.toHaveBeenCalled()
  await userEvent.clear(screen.getByRole('textbox', { name: 'Summary' }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), 'Engineer')
  await userEvent.click(screen.getByRole('button', { name: 'Rerun content check' }))
  expect(await screen.findByText('Check allowance exhausted.')).toBeInTheDocument()
  expect(screen.getByText('Save rejected.')).toBeInTheDocument()
})

it('follows the new saved report and preserves edits typed during saving', async () => {
  const next = { ...report, id: 'new-run', runId: 'new-run', contentFingerprint: 'new', createdAt: '2026-10-17T01:00:00Z' }
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="resume" sections={sections} />, mocks: [
    ...atsMocks(completed),
    { request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume', sections: [{ id: 'section', content: { text: 'Engineer edited' } }] } }, delay: 120, result: { data: { updateResume: { __typename: 'UpdateResumePayload', errors: [], resume: { __typename: 'Resume', id: 'resume', title: 'Resume', sections: [{ __typename: 'ResumeSection', ...sections[0], content: { text: 'Engineer edited' } }] } } } } },
    { request: { query: ATS_REPORT_QUERY, variables: { id: 'resume' } }, result: { data: { resume: { __typename: 'Resume', id: 'resume', atsReport: next } } } },
  ] })
  await userEvent.click(screen.getByRole('button', { name: /ATS check/ }))
  const field = screen.getByRole('textbox', { name: 'Summary' })
  await userEvent.type(field, ' edited')
  await userEvent.click(screen.getByRole('button', { name: 'Save resume' }))
  await userEvent.type(field, ' again')
  await waitFor(() => expect(screen.getByRole('button', { name: 'Save resume' })).toBeEnabled())
  expect(field).toHaveValue('Engineer edited again')
  expect(screen.getByText(/Unsaved edits make this feedback outdated/)).toBeInTheDocument()
  expect(await screen.findByRole('button', { name: 'Checking saved resume…' })).toBeDisabled()
})

it('keeps earlier feedback outdated if refreshing after a successful save fails', async () => {
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="resume" sections={sections} />, mocks: [
    ...atsMocks(completed),
    { request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume', sections: [{ id: 'section', content: { text: 'Engineer edited' } }] } }, result: { data: { updateResume: { __typename: 'UpdateResumePayload', errors: [], resume: { __typename: 'Resume', id: 'resume', title: 'Resume', sections: [{ __typename: 'ResumeSection', ...sections[0], content: { text: 'Engineer edited' } }] } } } } },
    { request: { query: ATS_REPORT_QUERY, variables: { id: 'resume' } }, error: new Error('Refresh unavailable') },
  ] })
  await userEvent.click(screen.getByRole('button', { name: /ATS check/ }))
  await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), ' edited')
  await userEvent.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByText(/Couldn't refresh the ATS report/)).toBeInTheDocument()
  expect(screen.getByText('Outdated feedback')).toBeInTheDocument()
  expect(screen.queryByText(/Unsaved edits make/)).not.toBeInTheDocument()
})

it('follows scheduling updates without a task and ignores a late report for an older run', async () => {
  let publish: (value: typeof report) => void = () => {}
  const link = new ApolloLink((operation) => new Observable((observer) => {
    if (operation.operationName === 'ResumeAtsReportUpdated') {
      publish = (value) => observer.next({ data: { atsReportUpdated: value } })
    } else {
      observer.next({ data: { resume: { __typename: 'Resume', id: 'resume', atsReport: report } } })
      observer.complete()
    }
  }))
  render(<MockedProvider link={link}><SavedResumeEditor resumeId="resume" sections={sections} /></MockedProvider>)
  await userEvent.click(screen.getByRole('button', { name: /ATS check/ }))
  expect(await screen.findByText('Content quality: queued')).toBeInTheDocument()
  const next = { ...completed, id: 'new', runId: 'new', createdAt: '2026-10-17T01:00:00Z' }
  await act(async () => { publish(next) })
  expect(screen.getByText('Content quality: completed — 80/100')).toBeInTheDocument()
  await userEvent.type(screen.getByRole('textbox', { name: 'Summary' }), ' typing')
  await act(async () => { publish(report) })
  expect(screen.getByText('Content quality: completed — previous score 80/100')).toBeInTheDocument()
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Engineer typing')
})
