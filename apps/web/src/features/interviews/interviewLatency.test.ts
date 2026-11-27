import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelInterviewTiming, finishInterviewTiming, interviewLatencyReport, keyInterviewTiming, startInterviewTiming, STREAMED_SPEECH_TIMING } from './interviewLatency'

afterEach(() => {
  performance.clearMeasures()
  vi.restoreAllMocks()
  for (const stage of ['speech-end-to-transcript', 'submit-to-reply', 'reply-to-audio', 'submit-to-audio'] as const) cancelInterviewTiming(stage)
})

function clock(...times: number[]) {
  const now = vi.spyOn(performance, 'now')
  for (const time of times) now.mockReturnValueOnce(time)
}

describe('interview latency timing', () => {
  it('records a finished stage as a content-free measure with its mode', () => {
    clock(100, 340)
    startInterviewTiming('speech-end-to-transcript', { mode: 'browser' })
    expect(finishInterviewTiming('speech-end-to-transcript')).toBe(240)

    const [entry] = performance.getEntriesByName('interview:speech-end-to-transcript')
    expect(entry.duration).toBe(240)
    expect((entry as PerformanceMeasure).detail).toEqual({ mode: 'browser' })
    expect(finishInterviewTiming('speech-end-to-transcript')).toBeNull()
  })

  it('finishes a keyed stage only for its own interviewer message', () => {
    clock(0, 500)
    startInterviewTiming('submit-to-audio', { mode: 'provider' })
    expect(finishInterviewTiming('submit-to-audio', 'message-1')).toBeNull()

    keyInterviewTiming('submit-to-audio', 'message-2')
    expect(finishInterviewTiming('submit-to-audio', 'message-1')).toBeNull()
    expect(finishInterviewTiming('submit-to-audio', 'message-2')).toBe(500)
  })

  it('can switch a keyed stage to the mode that will actually play it', () => {
    clock(0, 700)
    startInterviewTiming('submit-to-audio', { mode: 'browser' })
    keyInterviewTiming('submit-to-audio', 'stream:turn', STREAMED_SPEECH_TIMING)
    expect(finishInterviewTiming('submit-to-audio', 'stream:turn')).toBe(700)
    const [entry] = performance.getEntriesByName('interview:submit-to-audio')
    expect((entry as PerformanceMeasure).detail).toEqual({ mode: 'browser-streamed' })
  })

  it('records nothing for a cancelled stage', () => {
    startInterviewTiming('submit-to-reply')
    cancelInterviewTiming('submit-to-reply')
    expect(finishInterviewTiming('submit-to-reply')).toBeNull()
    expect(performance.getEntriesByName('interview:submit-to-reply')).toHaveLength(0)
  })

  it('summarizes each stage and mode separately', () => {
    clock(0, 100, 0, 300, 0, 200, 0, 900)
    for (let sample = 0; sample < 3; sample += 1) {
      startInterviewTiming('reply-to-audio', { mode: 'browser' }, 'message')
      finishInterviewTiming('reply-to-audio', 'message')
    }
    startInterviewTiming('reply-to-audio', { mode: 'provider' }, 'message')
    finishInterviewTiming('reply-to-audio', 'message')

    expect(interviewLatencyReport()).toEqual([
      { stage: 'reply-to-audio', mode: 'browser', count: 3, p50Ms: 200, p95Ms: 300, maxMs: 300 },
      { stage: 'reply-to-audio', mode: 'provider', count: 1, p50Ms: 900, p95Ms: 900, maxMs: 900 },
    ])
    expect(globalThis.__interviewLatency?.report).toBe(interviewLatencyReport)
  })
})
