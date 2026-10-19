/** Reproduce deletion followed immediately by navigation, before a render can clear
 * the unsaved state. Ordinary navigation must still protect the same draft.
 */
import { useRef } from 'react'
import { useNavigate } from 'react-router'
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { ResumeUnsavedChanges } from './ResumeUnsavedChanges'

function EditedResume() {
  const discarded = useRef(false)
  const navigate = useNavigate()
  return <>
    <ResumeUnsavedChanges dirty discarded={discarded} />
    <button onClick={() => navigate('/resumes')}>Back to resumes</button>
    <button onClick={() => {
      // A successful delete can navigate before React or router effects rerender.
      discarded.current = true
      navigate('/resumes')
    }}>Finish confirmed deletion</button>
  </>
}

it('checks confirmed deletion synchronously without waiting for a state update', async () => {
  const user = userEvent.setup()
  renderPage({ path: '/', url: '/', element: <EditedResume />,
    extraRoutes: [{ path: '/resumes', element: <p>Resume list</p> }],
  })
  await user.click(screen.getByRole('button', { name: 'Back to resumes' }))
  expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Keep editing' }))
  await user.click(screen.getByRole('button', { name: 'Finish confirmed deletion' }))
  expect(await screen.findByText('Resume list')).toBeInTheDocument()
  expect(screen.queryByRole('dialog', { name: 'Leave without saving?' })).not.toBeInTheDocument()
})
