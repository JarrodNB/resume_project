/** Exercise live editing with the real recording hook so typing cannot silently stop capture. */
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { renderPage } from '@/test/renderPage'
import { InterviewPage } from './InterviewPage'

const stopTrack = vi.fn()
const { session } = vi.hoisted(() => ({ session: {
  interview: {
    id: 'session', status: 'active', executionMode: 'real', speechPlaybackMode: 'provider', revision: 0, answerCap: 3, currentQuestionPosition: 0,
    questions: [{ id: 'question', content: 'Describe a project.', position: 0, acceptedAnswerCount: 0 }],
    messages: [{ id: 'opening', questionId: 'question', kind: 'opening', content: 'Describe a project.' }], operations: [],
  },
  loading: false, loadError: null, busy: false, unresolved: null, error: null, subscriptionError: null,
} }))
vi.mock('./useInterviewSession', () => ({ useInterviewSession: () => session, useStartInterview: () => ({}) }))
vi.mock('@/features/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }))

class Recognition {
  static latest: Recognition
  onresult: ((event: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null
  start() { Recognition.latest = this }
  stop() { this.onend?.() }
  abort = vi.fn()
  words(text: string) { this.onresult?.({ resultIndex: 0, results: [{ 0: { transcript: text }, isFinal: true }] }) }
}
class Recorder {
  static latest: Recorder
  static isTypeSupported = () => true
  state = 'inactive'
  mimeType = 'audio/webm'
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  start() { Recorder.latest = this; this.state = 'recording' }
  stop = vi.fn(() => { this.state = 'inactive'; this.ondataavailable?.({ data: new Blob(['audio']) }); this.onstop?.() })
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  vi.stubGlobal('MediaRecorder', Recorder)
  vi.stubGlobal('SpeechRecognition', Recognition)
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack, addEventListener: vi.fn() }] }) } })
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() }))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })

it('keeps the real microphone running while typing and continues filling new words', async () => {
  renderPage({ path: '/practice/interviews/:id', url: '/practice/interviews/session', element: <InterviewPage /> })
  fireEvent.click(screen.getByRole('button', { name: 'Record answer' }))
  await screen.findByRole('button', { name: 'Stop recording' })
  act(() => Recognition.latest.words('I built a tool'))
  const editor = screen.getByRole('textbox', { name: 'Your answer' })
  expect(editor).toHaveValue('I built a tool')
  fireEvent.change(editor, { target: { value: 'I designed a scheduling tool' } })
  expect(Recorder.latest.state).toBe('recording')
  expect(Recorder.latest.stop).not.toHaveBeenCalled()
  expect(stopTrack).not.toHaveBeenCalled()
  act(() => Recognition.latest.words('I built a tool for the team'))
  expect(editor).toHaveValue('I designed a scheduling tool for the team')
  expect(screen.getByRole('button', { name: 'Stop recording' })).toBeEnabled()
  fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Record answer' })).toBeDisabled())
  expect(Recorder.latest.stop).toHaveBeenCalledOnce()
})
