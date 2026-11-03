/** Checks that a saved resume's section order previews, saves and refreshes like an edit. */
import { useState } from 'react'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { SavedResumeEditor } from './SavedResumeEditor'
import { UPDATE_RESUME_MUTATION } from './tailorOperations'

vi.mock('./ResumePdfPreview', () => ({ ResumePdfPreview: ({ model }: { model: { blocks: { title: string }[] } }) => <p data-testid="preview-order">{model.blocks.map((block) => block.title).join(',')}</p> }))
// jsdom can't simulate drags, so this stand-in reports the drop a real drag would.
vi.mock('./ResumeSectionList', () => ({
  ResumeSectionList: ({ onReorder }: { onReorder: (ids: string[]) => void }) => <button type="button" onClick={() => onReorder(['skills', 'summary'])}>Drop Skills first</button>,
}))

const section = (id: string, sectionType: string, title: string, position: number, content: unknown) => ({ id, sectionType, title, position, content })
const sections = [
  section('contact', 'CONTACT', 'Contact', 0, { full_name: 'Ada' }),
  section('summary', 'SUMMARY', 'Summary', 1, { text: 'Backend engineer.' }),
  section('skills', 'SKILLS', 'Skills', 2, { items: [{ name: 'Ruby', category: 'Languages' }] }),
]

const saveStatus = () => screen.getAllByRole('status').find((element) => element.classList.contains('resume-save-status'))

function saveMock(sectionOrder?: string[]) {
  return {
    request: { query: UPDATE_RESUME_MUTATION, variables: (variables: { sectionOrder?: string[] }) => JSON.stringify(variables.sectionOrder) === JSON.stringify(sectionOrder) },
    result: { data: { updateResume: { __typename: 'UpdateResumePayload', errors: [], resume: { __typename: 'Resume', id: 'resume-1', title: 'Engineer', includeSummary: true, sections: [] } } } },
  }
}

/** The editor, with a button that delivers the server's refreshed sections. */
function Harness() {
  const [current, setCurrent] = useState(sections)
  return (
    <>
      <SavedResumeEditor resumeId="resume-1" sections={current} onDeleted={vi.fn()} />
      <button type="button" onClick={() => setCurrent([sections[0], { ...sections[2], position: 1 }, { ...sections[1], position: 2 }])}>Server refresh</button>
    </>
  )
}

async function dropSkillsFirst(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('button', { name: 'Drop Skills first' }))
}

it('previews a new order, blocks downloads until it is saved, and saves it with the content', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', element: <Harness />, mocks: [saveMock(['contact', 'skills', 'summary'])] })
  await dropSkillsFirst(user)
  expect(saveStatus()).toHaveTextContent('Unsaved changes')
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeDisabled()

  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('preview-order')).toHaveTextContent('Skills,Summary')

  await user.click(screen.getByRole('button', { name: /^Save/ }))
  await waitFor(() => expect(saveStatus()).toHaveTextContent('All changes saved'))
  expect(screen.getByRole('button', { name: 'Download PDF' })).toBeEnabled()
})

it('stays saved when the server returns the sections in their new order', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', element: <Harness />, mocks: [saveMock(['contact', 'skills', 'summary'])] })
  await dropSkillsFirst(user)
  await user.click(screen.getByRole('button', { name: /^Save/ }))
  await waitFor(() => expect(saveStatus()).toHaveTextContent('All changes saved'))

  await user.click(screen.getByRole('button', { name: 'Server refresh' }))
  expect(saveStatus()).toHaveTextContent('All changes saved')
  await user.click(screen.getByRole('button', { name: 'Preview' }))
  expect(screen.getByTestId('preview-order')).toHaveTextContent('Skills,Summary')
})

it('sends no order when the order did not change', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', element: <Harness />, mocks: [saveMock(undefined)] })
  await user.click(screen.getByRole('button', { name: 'Edit sections' }))
  await user.click(screen.getByRole('checkbox', { name: 'Include summary' }))
  await user.click(screen.getByRole('button', { name: /^Save/ }))
  await waitFor(() => expect(saveStatus()).toHaveTextContent('All changes saved'))
})
