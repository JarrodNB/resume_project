/** Check that save feedback and leave warnings follow what was actually persisted,
 * including failures and edits made while a request is still running.
 */
import { useState } from 'react'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { downloadResumePdf, downloadResumeDocx } from './resumeDownload'
import { SavedResumeEditor } from './SavedResumeEditor'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'

vi.mock('./resumeDownload', () => ({ downloadResumePdf: vi.fn().mockResolvedValue(undefined), downloadResumeDocx: vi.fn().mockResolvedValue(undefined) }))

vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: ({ model }: { model: unknown }) => <pre data-testid="pdf-model">{JSON.stringify(model)}</pre> }))

const sections = [{ id: 'section-1', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'Original summary.' } }]

function updateMock(text: string, errors: string[] = [], delay = 10) {
  return {
    request: { query: UPDATE_RESUME_MUTATION, variables: { id: 'resume-1', includeSummary: true, sections: [{ id: 'section-1', content: { text } }] } },
    delay,
    result: { data: { updateResume: {
      __typename: 'UpdateResumePayload', errors,
      resume: errors.length ? null : { __typename: 'Resume', id: 'resume-1', title: 'Engineer', sections: [{ __typename: 'ResumeSection', ...sections[0], content: { text } }] },
    } } },
  }
}

function renderEditor(mocks: ReturnType<typeof updateMock>[] = []) {
  return renderPage({ path: '/', url: '/', mocks,
    element: <><SavedResumeEditor resumeId="resume-1" sections={sections} onDeleted={vi.fn()} /><Link to="/jobs">Jobs</Link></>,
    extraRoutes: [{ path: '/jobs', element: <p>Job list</p> }],
  })
}

it('protects edited content, recognizes reverted edits, and allows leaving after a successful save', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock('Edited summary.')])
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  const cleanUnload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, cleanUnload)
  expect(cleanUnload.defaultPrevented).toBe(false)
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  const input = screen.getByRole('textbox', { name: 'Summary' })
  await user.type(input, ' Updated')
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeDisabled()
  const dirtyUnload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, dirtyUnload)
  expect(dirtyUnload.defaultPrevented).toBe(true)
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  expect(input).toHaveValue('Original summary. Updated')
  await user.clear(input)
  await user.type(input, 'Original summary.')
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  await user.clear(input)
  await user.type(input, 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
  const savedUnload = new Event('beforeunload', { cancelable: true })
  fireEvent(window, savedUnload)
  expect(savedUnload.defaultPrevented).toBe(false)
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(await screen.findByText('Job list')).toBeInTheDocument()
})

it('keeps unsaved work after failure and clears its warning only after retry succeeds', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock('Edited summary.', ['Save unavailable.']), updateMock('Edited summary.')])
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  const input = screen.getByRole('textbox', { name: 'Summary' })
  await user.clear(input)
  await user.type(input, 'Edited summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(await screen.findByText('Save unavailable.')).toBeInTheDocument()
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeDisabled()
  expect(input).toHaveValue('Edited summary.')
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
})

it('keeps later edits unsaved when an earlier snapshot finishes saving', async () => {
  const user = userEvent.setup()
  renderEditor([updateMock('Submitted summary.', [], 300)])
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  const input = screen.getByRole('textbox', { name: 'Summary' })
  await user.clear(input)
  await user.type(input, 'Submitted summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  expect(screen.getByRole('status')).toHaveTextContent('Saving your resume…')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeDisabled()
  await user.type(input, ' More edits.')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes'))
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Download DOCX' })).toBeDisabled()
  expect(input).toHaveValue('Submitted summary. More edits.')
  await user.click(screen.getByRole('link', { name: 'Jobs' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
})


describe.each([['PDF', downloadResumePdf], ['DOCX', downloadResumeDocx]] as const)('%s export', (format, download) => {
  it('offers downloads only for saved content and requires saving edits before downloading', async () => {
    const user = userEvent.setup()
    renderEditor([updateMock('Edited summary.')])
    const button = screen.getByRole('button', { name: `Download ${format}` })
    expect(button).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
    await user.clear(screen.getByRole('textbox', { name: 'Summary' }))
    await user.type(screen.getByRole('textbox', { name: 'Summary' }), 'Edited summary.')
    expect(button).toBeDisabled()
    expect(screen.getByText('Save your changes to download')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save resume' }))
    await waitFor(() => expect(button).toBeEnabled())
    await user.click(button)
    expect(download).toHaveBeenLastCalledWith(expect.objectContaining({ blocks: [expect.objectContaining({ text: 'Edited summary.' })] }), '')
  })


  it('captures saved content, blocks duplicate generation, and preserves edits during export', async () => {
    const user = userEvent.setup()
    let finish!: () => void
    vi.mocked(download).mockClear().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    renderEditor()
    await user.click(screen.getByRole('button', { name: `Download ${format}` }))
    const preparing = screen.getByRole('button', { name: `Preparing ${format}…` })
    expect(preparing).toBeDisabled()
    expect(screen.getByRole('button', { name: format === 'PDF' ? 'Download DOCX' : 'Download PDF' })).toBeDisabled()
    await user.click(preparing)
    expect(download).toHaveBeenCalledOnce()
    const captured = vi.mocked(download).mock.calls[0][0]
    await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
    await user.type(screen.getByRole('textbox', { name: 'Summary' }), ' Later edit.')
    expect(captured.blocks[0].text).toBe('Original summary.')
    await act(async () => finish())
    expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
    expect(screen.getByRole('button', { name: `Download ${format}` })).toBeDisabled()
  })

  it('recovers after generation failure and allows retry without changing saved state', async () => {
    const user = userEvent.setup()
    vi.mocked(download).mockClear().mockRejectedValueOnce(new Error('Renderer failed')).mockResolvedValueOnce(undefined)
    renderEditor()
    await user.click(screen.getByRole('button', { name: `Download ${format}` }))
    expect(await screen.findByText(`Could not download the ${format}. Please try again.`)).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
    await user.click(screen.getByRole('button', { name: `Download ${format}` }))
    await waitFor(() => expect(download).toHaveBeenCalledTimes(2))
    expect(screen.queryByText(`Could not download the ${format}. Please try again.`)).not.toBeInTheDocument()
  })

})


it('starts with the saved preview and preserves unsaved edits when switching views', async () => {
  const user = userEvent.setup()
  renderEditor()
  expect(screen.getByRole('button', { name: 'Preview' })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByTestId('pdf-model')).toHaveTextContent('Original summary.')
  expect(screen.queryByRole('button', { name: 'Summary' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  await user.type(screen.getByRole('textbox', { name: 'Summary' }), ' My edit.')
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('pdf-model')).toHaveTextContent('Original summary. My edit.')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Original summary. My edit.')
})

it('saves a summary inclusion round trip without losing its text', async () => {
  const user = userEvent.setup()
  const hidden = updateMock('Original summary.')
  hidden.request.variables.includeSummary = false
  const shown = updateMock('Original summary.')
  renderEditor([hidden, shown])
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('pdf-model')).not.toHaveTextContent('Original summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('pdf-model')).toHaveTextContent('Original summary.')
  await user.click(screen.getByRole('button', { name: 'Save resume' }))
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('All changes saved'))
})

it('keeps the summary choice editable on a resume with no summary section', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="resume-1" sections={[]} includeSummary={false} onDeleted={vi.fn()} /> })
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  expect(screen.getByRole('checkbox', { name: 'Include summary' })).not.toBeChecked()
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  expect(screen.getByRole('status')).toHaveTextContent('Unsaved changes')
})

it('offers explicit resume summary generation and pauses it for unsaved section edits', async () => {
  const user = userEvent.setup()
  const { SUMMARY_GENERATION_QUERY } = await import('@/features/summary-generation/summaryGenerationOperations')
  renderPage({ path: '/', url: '/', element: <SavedResumeEditor resumeId="resume-1" sections={[{ id: 'skills-1', sectionType: 'SKILLS', title: 'Skills', position: 0, content: { items: [{ name: 'Ruby' }] } }]} onDeleted={vi.fn()} />, mocks: [
    { request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'resume', targetId: 'resume-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: null } } } },
  ] })
  expect(await screen.findByRole('button', { name: 'Generate summary' })).toBeEnabled()
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Skills' }))
  await user.type(screen.getByRole('textbox', { name: 'New skill' }), 'Python{Enter}')
  expect(screen.getByRole('button', { name: 'Generate summary' })).toBeDisabled()
})


it('preserves section edits by ID when a refreshed summary is inserted ahead of them', async () => {
  const user = userEvent.setup()
  const { SUMMARY_GENERATION_QUERY } = await import('@/features/summary-generation/summaryGenerationOperations')
  const skills = { id: 'skills-1', sectionType: 'SKILLS', title: 'Skills', position: 0, content: { items: [{ name: 'Ruby' }] } }
  const inserted = { id: 'summary-2', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'New saved summary.' } }
  function Harness() {
    const [current, setCurrent] = useState<Parameters<typeof SavedResumeEditor>[0]['sections']>([skills])
    return <><button onClick={() => setCurrent([inserted, { ...skills, position: 1 }])}>Refresh saved resume</button><SavedResumeEditor resumeId="resume-1" sections={current} includeSummary={false} onDeleted={vi.fn()} /></>
  }
  renderPage({ path: '/', url: '/', element: <Harness />, mocks: [
    { request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'resume', targetId: 'resume-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: null } } } },
  ] })
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Skills' }))
  await user.type(screen.getByRole('textbox', { name: 'New skill' }), 'Python{Enter}')
  await user.click(screen.getByRole('button', { name: 'Refresh saved resume' }))
  expect(screen.getByText('Python')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Include summary' })).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('New saved summary.')
  expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Remove Python' }))
  expect(screen.getByText('All changes saved')).toBeInTheDocument()
})

it('accepts a reviewed resume summary then refreshes output without changing inclusion', async () => {
  const user = userEvent.setup()
  const { SUMMARY_GENERATION_QUERY, ACCEPT_SUMMARY_GENERATION_MUTATION } = await import('@/features/summary-generation/summaryGenerationOperations')
  const proposal = { __typename: 'AiTask', id: 'summary-task', status: 'COMPLETED', result: { text: 'A reviewed summary.' }, errorMessage: null, acceptedAt: null }
  function Harness() {
    const [current, setCurrent] = useState<Parameters<typeof SavedResumeEditor>[0]['sections']>([{ id: 'skills-1', sectionType: 'SKILLS', title: 'Skills', position: 0, content: { items: [{ name: 'Ruby' }] } }])
    return <SavedResumeEditor resumeId="resume-1" sections={current} includeSummary={false} onDeleted={vi.fn()} onSummaryAccepted={() => setCurrent((previous) => [{ id: 'new-summary', sectionType: 'SUMMARY', title: 'Summary', position: 0, content: { text: 'A reviewed summary.' } }, ...previous.map((section) => ({ ...section, position: section.position + 1 }))])} />
  }
  renderPage({ path: '/', url: '/', element: <Harness />, mocks: [
    { request: { query: SUMMARY_GENERATION_QUERY, variables: { targetKind: 'resume', targetId: 'resume-1' } }, result: { data: { summaryGeneration: { __typename: 'SummaryGeneration', stale: false, aiTask: proposal } } } },
    { request: { query: ACCEPT_SUMMARY_GENERATION_MUTATION, variables: { aiTaskId: 'summary-task', text: 'A reviewed summary.' } }, result: { data: { acceptSummaryGeneration: { __typename: 'AcceptSummaryGenerationPayload', aiTask: { ...proposal, acceptedAt: '2026-10-28T00:00:00Z' }, errors: [] } } } },
  ] })
  await user.click(await screen.findByRole('button', { name: 'Accept summary' }))
  await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Proposed summary' })).not.toBeInTheDocument())
  expect(screen.getByTestId('pdf-model')).not.toHaveTextContent('A reviewed summary.')
  expect(screen.getByRole('status')).toHaveTextContent('All changes saved')
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  expect(screen.getByRole('checkbox', { name: 'Include summary' })).not.toBeChecked()
  await user.click(screen.getByRole('button', { name: 'Summary' }))
  expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('A reviewed summary.')
})
