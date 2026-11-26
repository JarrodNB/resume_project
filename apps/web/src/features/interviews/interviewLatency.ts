/** Time the parts of a spoken turn that only the browser can see.
 * Each finished stage becomes a `performance.measure` entry named `interview:<stage>`, so the
 * DevTools Performance panel shows it. `__interviewLatency.report()` in the console summarizes them.
 * Entries hold only durations, the input/playback mode and whether playback was automatic: no text,
 * audio or IDs. Nothing leaves the browser, and the clock is separate from Rails and Python timings.
 */

export type InterviewLatencyStage =
  | 'speech-end-to-transcript'
  | 'recording-to-transcript'
  | 'submit-to-reply'
  | 'reply-to-audio'
  | 'submit-to-audio'

type Detail = { mode: string }
const ALL_MODES: Detail = { mode: 'all' }
type Pending = { start: number; key: string | null; detail: Detail }
type Summary = { stage: InterviewLatencyStage; mode: string; count: number; p50Ms: number; p95Ms: number; maxMs: number }

const PREFIX = 'interview:'
const pending = new Map<InterviewLatencyStage, Pending>()

/** Start (or restart) a stage. A key ties the finish to one interviewer message. */
export function startInterviewTiming(stage: InterviewLatencyStage, detail: Detail = ALL_MODES, key: string | null = null) {
  pending.set(stage, { start: performance.now(), key, detail })
}

/** Attach a key to a stage that started before its message existed. */
export function keyInterviewTiming(stage: InterviewLatencyStage, key: string) {
  const current = pending.get(stage)
  if (current) current.key = key
}

/** Record a pending stage when its key matches. Returns the duration in milliseconds, or null. */
export function finishInterviewTiming(stage: InterviewLatencyStage, key: string | null = null) {
  const current = pending.get(stage)
  if (!current || current.key !== key) return null
  pending.delete(stage)
  const end = performance.now()
  try {
    performance.measure(`${PREFIX}${stage}`, { start: current.start, end, detail: current.detail })
  } catch {
    // Older browsers without measure options still return the duration to the caller.
  }
  return end - current.start
}

export function cancelInterviewTiming(stage: InterviewLatencyStage) {
  pending.delete(stage)
}

function percentile(sorted: number[], fraction: number) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)]
}

/** Summarize recorded stages by mode, rounded to whole milliseconds. */
export function interviewLatencyReport(): Summary[] {
  type Group = { stage: InterviewLatencyStage; mode: string; durations: number[] }
  const groups = new Map<string, Group>()
  for (const entry of performance.getEntriesByType('measure')) {
    if (!entry.name.startsWith(PREFIX)) continue
    const stage = entry.name.slice(PREFIX.length) as InterviewLatencyStage
    const mode = (entry as PerformanceMeasure).detail?.mode ?? 'unknown'
    const group: Group = groups.get(`${stage}:${mode}`) ?? { stage, mode, durations: [] }
    group.durations.push(entry.duration)
    groups.set(`${stage}:${mode}`, group)
  }
  return [...groups.values()].map(({ stage, mode, durations }) => {
    const sorted = durations.sort((a, b) => a - b)
    return {
      stage, mode, count: sorted.length,
      p50Ms: Math.round(percentile(sorted, 0.5)),
      p95Ms: Math.round(percentile(sorted, 0.95)),
      maxMs: Math.round(sorted[sorted.length - 1]),
    }
  })
}

declare global {
  var __interviewLatency: { report: () => Summary[] } | undefined
}
globalThis.__interviewLatency = { report: interviewLatencyReport }
