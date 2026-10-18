/** Resume section names and display titles shared by editors and PDF previews. */
export const SECTION_ORDER = ['contact', 'summary', 'experience', 'projects', 'education', 'certifications', 'skills'] as const

export type TailorSectionType = (typeof SECTION_ORDER)[number]

export const SECTION_TITLES: Record<TailorSectionType, string> = {
  contact: 'Contact',
  summary: 'Summary',
  experience: 'Experience',
  projects: 'Projects',
  education: 'Education',
  certifications: 'Certifications',
  skills: 'Skills',
}

/** A section type string, or null when it isn't one we write. */
export function asSectionType(value: unknown): TailorSectionType | null {
  return SECTION_ORDER.find((sectionType) => sectionType === value) ?? null
}
