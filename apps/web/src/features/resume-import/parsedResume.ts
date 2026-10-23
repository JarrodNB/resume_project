/** Read parser task JSON for resume review, with snake_case fields matching the AI schema.
 * Employer blocks keep ordered roles and separate shared highlights. Legacy flat blocks
 * normalize only in memory; parser source identifiers never enter the editable experience.
 */
export interface ParsedLink {
  label: string
  url: string
}
export interface ParsedContactInfo {
  full_name: string | null
  email: string | null
  phone: string | null
  location: string | null
  links: ParsedLink[]
}

export interface ParsedExperienceRole {
  title: string
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  highlights: string[]
}

export interface ParsedExperience {
  company: string
  location: string | null
  description: string | null
  roles: ParsedExperienceRole[]
  shared_highlights: string[]
}

export interface ParsedProject {
  name: string
  role: string | null
  url: string | null
  start_date: string | null
  end_date: string | null
  description: string | null
}

export interface ParsedEducation {
  institution: string
  degree: string | null
  field_of_study: string | null
  start_date: string | null
  end_date: string | null
  description: string | null
}

export interface ParsedCertification {
  name: string
  issuer: string | null
  issued_date: string | null
  expiry_date: string | null
  credential_id: string | null
  credential_url: string | null
  description: string | null
}

export interface ParsedSkill {
  name: string
  category: string | null
}

export interface ParsedResume {
  contact: ParsedContactInfo
  summary: string | null
  experiences: ParsedExperience[]
  projects: ParsedProject[]
  educations: ParsedEducation[]
  certifications: ParsedCertification[]
  skills: ParsedSkill[]
  parsing_warnings: string[]
}

/** Returns the task result's `parsed_resume` with missing fields defaulted, or null if absent. */
export function parsedResumeFromTaskResult(result: unknown): ParsedResume | null {
  const parsed = (result as { parsed_resume?: Partial<ParsedResume> } | null)?.parsed_resume
  if (!parsed) return null
  return {
    contact: { full_name: null, email: null, phone: null, location: null, ...parsed.contact, links: parsedLinks((parsed.contact as { links?: unknown } | undefined)?.links) },
    summary: parsed.summary ?? null,
    experiences: (parsed.experiences ?? []).map((experience) => normalizeParsedExperience(experience)),
    projects: (parsed.projects ?? []).map((project) => ({ ...emptyProject(), ...project })),
    educations: (parsed.educations ?? []).map((education) => ({ ...emptyEducation(), ...education })),
    certifications: (parsed.certifications ?? []).map((certification) => ({ ...emptyCertification(), ...certification })),
    skills: (parsed.skills ?? []).map((skill) => ({ ...skill, category: skill.category ?? null })),
    parsing_warnings: parsed.parsing_warnings ?? [],
  }
}

/** Reads structured or legacy string-only links and makes bare web addresses valid URLs. */
export function parsedLinks(value: unknown): ParsedLink[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((link) => {
    if (typeof link === 'string') return [{ label: link, url: normalizeBareWebUrl(link) }]
    if (typeof link !== 'object' || link === null) return []
    const record = link as Record<string, unknown>
    return typeof record.label === 'string' && typeof record.url === 'string'
      ? [{ label: record.label, url: normalizeBareWebUrl(record.url) }]
      : []
  })
}

/** Adds the conventional secure scheme when an extracted link is a bare domain address. */
function normalizeBareWebUrl(value: string): string {
  const trimmed = value.trim()
  if (!trimmed || /^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed
  return /^(?:www\.)?[\w-]+(?:\.[\w-]+)+(?:[/:?#][^\s]*)?$/i.test(trimmed)
    ? `https://${trimmed}`
    : trimmed
}
/** A blank role within an employer block. */
export function emptyExperienceRole(): ParsedExperienceRole {
  return { title: '', start_date: null, end_date: null, is_current: false, description: null, highlights: [] }
}

/** A blank employer block with one role. */
export function emptyExperience(): ParsedExperience {
  return { company: '', location: null, description: null, roles: [emptyExperienceRole()], shared_highlights: [] }
}

/** Normalize old task JSON only on read; never coalesce separate employer blocks. */
export function normalizeParsedExperience(value: unknown): ParsedExperience {
  const item = value as Partial<ParsedExperience & ParsedExperienceRole>
  const roles = Array.isArray(item.roles) ? item.roles : [item]
  return {
    company: item.company ?? '', location: item.location ?? null, description: Array.isArray(item.roles) ? item.description ?? null : null,
    roles: roles.map((role) => ({
      title: role.title ?? '', start_date: role.start_date ?? null, end_date: role.end_date ?? null,
      is_current: role.is_current ?? false, description: role.description ?? null, highlights: role.highlights ?? [],
    })),
    shared_highlights: item.shared_highlights ?? [],
  }
}

/** A blank project. */
export function emptyProject(): ParsedProject {
  return { name: '', role: null, url: null, start_date: null, end_date: null, description: null }
}

/** A blank education entry. */
export function emptyEducation(): ParsedEducation {
  return { institution: '', degree: null, field_of_study: null, start_date: null, end_date: null, description: null }
}

/** A blank certification entry. */
export function emptyCertification(): ParsedCertification {
  return { name: '', issuer: null, issued_date: null, expiry_date: null, credential_id: null, credential_url: null, description: null }
}
