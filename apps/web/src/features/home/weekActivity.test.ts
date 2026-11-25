/** Checks that the weekly activity counts only the last seven local days and sorts events into the right kind and day. */
import { expect, it } from 'vitest'
import { buildWeekActivity } from './weekActivity'

const now = new Date(2026, 10, 25, 15, 0) // Wed 25 Nov 2026, local time
const at = (day: number, hour = 9) => new Date(2026, 10, day, hour).toISOString()
const none = { jobsSaved: [], applicationsSent: [], interviewsPracticed: [], resumesEdited: [] }

it('covers seven days ending today, oldest first', () => {
  const { days } = buildWeekActivity(now, none)
  expect(days).toHaveLength(7)
  expect(days.map((day) => day.key)).toEqual(['2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25'])
  expect(days.filter((day) => day.isToday).map((day) => day.key)).toEqual(['2026-11-25'])
})

it('counts each kind on its own day and ignores anything older than the window', () => {
  const week = buildWeekActivity(now, {
    jobsSaved: [at(25, 1), at(25, 23), at(18)],
    applicationsSent: [at(24)],
    interviewsPracticed: [at(19, 0)],
    resumesEdited: [at(22), at(22), at(26)],
  })
  expect(week.totals).toEqual({ jobsSaved: 2, applicationsSent: 1, interviewsPracticed: 1, resumesEdited: 2 })
  expect(week.total).toBe(6)
  const counts = Object.fromEntries(week.days.map((day) => [day.key, day.count]))
  expect(counts['2026-11-25']).toBe(2)
  expect(counts['2026-11-22']).toBe(2)
  expect(counts['2026-11-24']).toBe(1)
  expect(counts['2026-11-19']).toBe(1)
})

it('is empty when nothing happened', () => {
  const week = buildWeekActivity(now, none)
  expect(week.total).toBe(0)
  expect(week.days.every((day) => day.count === 0)).toBe(true)
})
