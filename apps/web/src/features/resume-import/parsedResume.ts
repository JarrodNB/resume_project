/**
 * Description: TypeScript mirror of the AI service's ParsedResume (services/ai/schemas/parsed_resume.py),
 * the JSON a parse_resume task returns in `result.parsed_resume`. Dates are partial: "YYYY-MM" or "YYYY".
 * Index:
 *   - ParsedLink, ParsedContactInfo, ParsedExperience, ParsedProject, ParsedEducation, ParsedSkill, ParsedResume
 *   - parsedResumeFromTaskResult: reads a task result into a ParsedResume with defaults filled in
 *   - emptyExperience, emptyProject, emptyEducation: blank entries for "Add" buttons
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

export interface ParsedExperience {
  company: string
  title: string
  location: string | null
  start_date: string | null
  end_date: string | null
  is_current: boolean
  description: string | null
  highlights: string[]
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
    experiences: (parsed.experiences ?? []).map((experience) => ({ ...emptyExperience(), ...experience })),
    projects: (parsed.projects ?? []).map((project) => ({ ...emptyProject(), ...project })),
    educations: (parsed.educations ?? []).map((education) => ({ ...emptyEducation(), ...education })),
    skills: (parsed.skills ?? []).map((skill) => ({ ...skill, category: skill.category ?? null })),
    parsing_warnings: parsed.parsing_warnings ?? [],
  }
}

/** Reads structured links and upgrades legacy string-only task results. */
export function parsedLinks(value: unknown): ParsedLink[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((link) => {
    if (typeof link === 'string') return [{ label: link, url: link }]
    if (typeof link !== 'object' || link === null) return []
    const record = link as Record<string, unknown>
    return typeof record.label === 'string' && typeof record.url === 'string'
      ? [{ label: record.label, url: record.url }]
      : []
  })
}
/** A blank experience. */
export function emptyExperience(): ParsedExperience {
  return {
    company: '',
    title: '',
    location: null,
    start_date: null,
    end_date: null,
    is_current: false,
    description: null,
    highlights: [],
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
