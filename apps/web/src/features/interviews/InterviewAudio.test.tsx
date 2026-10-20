/** Playback renews an owned grant for the same accepted message, never a synthesis request. */
import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewAudio } from './InterviewAudio'
import { INTERVIEW_PLAYBACK } from './interviewOperations'
it('renews an expired playback grant for the same saved message', async () => {
  const request = { query: INTERVIEW_PLAYBACK, variables: { input: { interviewId: 'session', messageId: 'message' } } }
  const playback = (url: string) => ({ data: { interviewPlayback: { __typename: 'InterviewPlaybackPayload', errors: [], playback: { __typename: 'InterviewPlayback', playbackUrl: url, expiresIn: 60, contentType: 'audio/wav' } } } })
  const { container } = renderPage({ path: '/', url: '/', element: <InterviewAudio interviewId="session" messageId="message" />, mocks: [
    { request, result: playback('https://storage.test/first') }, { request, result: playback('https://storage.test/renewed') },
  ] })
  await userEvent.click(screen.getByRole('button', { name: 'Load saved audio' }))
  await screen.findByRole('button', { name: 'Refresh playback link' })
  expect(container.querySelector('audio')).toHaveAttribute('src', 'https://storage.test/first')
  fireEvent.error(container.querySelector('audio')!)
  expect(screen.getByRole('alert')).toHaveTextContent('may have expired')
  await userEvent.click(screen.getByRole('button', { name: 'Load saved audio' }))
  await screen.findByRole('button', { name: 'Refresh playback link' })
  expect(container.querySelector('audio')).toHaveAttribute('src', 'https://storage.test/renewed')
})
