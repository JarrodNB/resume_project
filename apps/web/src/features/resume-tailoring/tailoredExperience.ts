/** Normalize saved employment snapshots without changing their source JSON.
 * Shared bullets stay on the entry; nested roles carry only explicitly scoped bullets.
 */
import { withDraftKey, type DraftExperience, type DraftHighlight } from '@/features/resume-import/review/reviewDraft'
import { emptyExperience } from '@/features/resume-import/parsedResume'

export interface TailoredHighlight extends DraftHighlight { sourceIds: string[] }
export interface TailoredRole {
  key: string
  id: string | null
  title: string
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  highlights: TailoredHighlight[]
}
export interface TailoredExperience extends DraftExperience {
  source_experience_id?: string
  roles: TailoredRole[]
  highlights: TailoredHighlight[]
}

const record = (value: unknown): Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string | null => typeof value === 'string' ? value : null

function bullets(value: Record<string, unknown>): TailoredHighlight[] {
  const sources = Array.isArray(value.highlight_source_ids) ? value.highlight_source_ids : []
  return (Array.isArray(value.highlights) ? value.highlights : []).flatMap((value, index) => typeof value === 'string'
    ? [withDraftKey({ text: value, sourceIds: Array.isArray(sources[index]) ? sources[index].filter((id: unknown): id is string => typeof id === 'string') : [] })] : [])
}

/** Legacy single-title snapshots become one role in memory; separate entries remain separate. */
export function tailoredExperienceFrom(value: unknown): TailoredExperience {
  const item = record(value)
  const roles = Array.isArray(item.roles) && item.roles.length > 0 ? item.roles : [{ ...item, description: null, highlights: [], highlight_source_ids: [] }]
  return withDraftKey({ ...emptyExperience(), ...item, roles: roles.map((value) => {
    const role = record(value)
    return withDraftKey({ id: text(role.id), title: text(role.title) ?? '', start_date: text(role.start_date), end_date: text(role.end_date), is_current: role.is_current === true, description: text(role.description), highlights: bullets(role) })
  }), highlights: bullets(item) }) as TailoredExperience
}

/** Save only persistent snapshot fields, preserving evidence IDs through edits and reorders. */
export function tailoredExperienceContent(item: TailoredExperience): Record<string, unknown> {
  const { key: _key, highlights, roles, ...rest } = item
  return { ...rest, highlights: highlights.map((bullet) => bullet.text), highlight_source_ids: highlights.map((bullet) => bullet.sourceIds ?? []), roles: roles.map(({ key: _roleKey, highlights, ...role }) => ({
    ...role, highlights: highlights.map((bullet) => bullet.text), highlight_source_ids: highlights.map((bullet) => bullet.sourceIds ?? []),
  })) }
}
