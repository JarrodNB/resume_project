/** Verify local playback and private URL cleanup through the rendered player. */
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { RecordingReview } from './RecordingReview'

beforeEach(() => {
  URL.createObjectURL = vi.fn().mockReturnValueOnce('blob:first').mockReturnValueOnce('blob:second')
  URL.revokeObjectURL = vi.fn()
})
it('plays the local blob and releases URLs on replacement and unmount', () => {
  const first = new Blob(['first'])
  const { rerender, unmount } = render(<RecordingReview recording={first} />)
  expect(URL.createObjectURL).toHaveBeenCalledWith(first)
  expect(screen.getByLabelText('Your recording preview')).toHaveAttribute('src', 'blob:first')
  rerender(<RecordingReview recording={new Blob(['second'])} />)
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first')
  expect(screen.getByLabelText('Your recording preview')).toHaveAttribute('src', 'blob:second')
  unmount()
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second')
})
it('explains playback failure without removing the recording', () => {
  render(<RecordingReview recording={new Blob(['answer'])} />)
  fireEvent.error(screen.getByLabelText('Your recording preview'))
  expect(screen.getByRole('alert')).toHaveTextContent('You can still submit your reviewed text or re-record')
})
it('allows recovery when object URL creation is unsupported', () => {
  vi.mocked(URL.createObjectURL).mockReset().mockImplementation(() => { throw new Error('unsupported') })
  render(<RecordingReview recording={new Blob(['answer'])} />)
  expect(screen.getByRole('alert')).toHaveTextContent('You can still submit your reviewed text or re-record')
})

it('keeps playback collapsed until explicitly opened', () => {
  render(<RecordingReview recording={new Blob(['answer'])} />)
  expect(screen.getByText('Review recording').closest('details')).not.toHaveAttribute('open')
  fireEvent.click(screen.getByText('Review recording'))
  expect(screen.getByText('Review recording').closest('details')).toHaveAttribute('open')
})
