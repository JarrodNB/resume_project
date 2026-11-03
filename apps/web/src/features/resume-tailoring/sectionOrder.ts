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

export type MovableSectionType = Exclude<TailorSectionType, 'contact'>

/** The sections a user can arrange, in the standard order. Contact is always the header. */
export const MOVABLE_SECTIONS = SECTION_ORDER.filter((sectionType): sectionType is MovableSectionType => sectionType !== 'contact')

/** Returns sections in `order`, with contact first and any unlisted section after the rest. */
export function sectionsInOrder<Section extends { sectionType: TailorSectionType }>(sections: Section[], order: readonly TailorSectionType[]): Section[] {
  const rank = (section: Section) => {
    if (section.sectionType === 'contact') return -1
    const index = order.indexOf(section.sectionType)
    return index === -1 ? order.length : index
  }
  return [...sections].sort((left, right) => rank(left) - rank(right))
}

/**
 * The default order after adopting one resume's order. A resume may lack some sections, so
 * those keep their place in the default and the resume's sections fill the remaining slots.
 */
export function defaultOrderFromResume(resumeOrder: readonly TailorSectionType[], defaultOrder: readonly MovableSectionType[]): MovableSectionType[] {
  const present = resumeOrder.filter((sectionType): sectionType is MovableSectionType => sectionType !== 'contact')
  let next = 0
  return defaultOrder.map((sectionType) => (present.includes(sectionType) ? present[next++] : sectionType))
}
