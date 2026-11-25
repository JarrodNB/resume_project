/** Counts what the user did in the last seven days, from dates the app already saves.
 *
 * Four things count: jobs saved, applications sent (the date a job moved to Applied), interviews
 * practiced (spoken interviews started) and resumes edited. Days are the user's own local days,
 * oldest first, ending today. Nothing here is stored; it is worked out each time Home loads.
 */
export interface WeekEvents {
  jobsSaved: string[]
  applicationsSent: string[]
  interviewsPracticed: string[]
  resumesEdited: string[]
}

export interface WeekDay { key: string; label: string; count: number; isToday: boolean }
export interface WeekActivity {
  days: WeekDay[]
  totals: Record<keyof WeekEvents, number>
  total: number
}

const DAY_COUNT = 7

/** `2026-11-25` for the local calendar day of a date. */
function dayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function buildWeekActivity(now: Date, events: WeekEvents): WeekActivity {
  const days: WeekDay[] = Array.from({ length: DAY_COUNT }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (DAY_COUNT - 1 - index))
    return { key: dayKey(date), label: date.toLocaleDateString(undefined, { weekday: 'short' }), count: 0, isToday: index === DAY_COUNT - 1 }
  })
  const byKey = new Map(days.map((day) => [day.key, day]))
  const totals = { jobsSaved: 0, applicationsSent: 0, interviewsPracticed: 0, resumesEdited: 0 }
  for (const kind of Object.keys(events) as (keyof WeekEvents)[]) {
    for (const timestamp of events[kind]) {
      const day = byKey.get(dayKey(new Date(timestamp)))
      if (!day) continue
      day.count += 1
      totals[kind] += 1
    }
  }
  return { days, totals, total: Object.values(totals).reduce((sum, count) => sum + count, 0) }
}
