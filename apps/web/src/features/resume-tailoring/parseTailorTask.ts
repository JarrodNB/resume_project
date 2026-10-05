/**
 * Description: Reads a tailor_resume task (its input, the open question, or the finished draft)
 * into the sections the page shows.
 * Index:
 *   - TailorSection / OpenSection: one decided section, and the section waiting on the user
 *   - approvedSectionsFromInput / openSectionFromTask / finishedSectionsFromResult
 */
import { asSectionType, SECTION_TITLES, type TailorSectionType } from './sectionOrder'

export interface TailorSection {
  sectionType: TailorSectionType
  title: string
  content: unknown
  omitted: boolean
}

export interface OpenSection {
  sectionType: TailorSectionType
  title: string
  content: unknown
  nothingFits: boolean
  blocked: boolean
  message: string | null
  warnings: string[]
}

/** Sections already decided, in resume order, including ones the user left out. */
export function approvedSectionsFromInput(input: unknown): TailorSection[] {
  const approved = isRecord(input) && Array.isArray(input.approved_sections) ? input.approved_sections : []
  return approved.map(parseSection).filter((section): section is TailorSection => section !== null)
}

/** The section the task is paused on, or null when it isn't waiting. */
export function openSectionFromTask(pendingQuestions: unknown): OpenSection | null {
  const question = Array.isArray(pendingQuestions) ? pendingQuestions[0] : null
  if (!isRecord(question)) return null
  const sectionType = asSectionType(question.section_type)
  if (!sectionType) return null
  return {
    sectionType,
    title: typeof question.title === 'string' ? question.title : SECTION_TITLES[sectionType],
    content: question.content ?? {},
    nothingFits: question.nothing_fits === true,
    blocked: question.blocked === true,
    message: typeof question.message === 'string' ? question.message : null,
    warnings: stringList(question.warnings),
  }
}

/** The finished draft's sections (omitted ones are already gone). */
export function finishedSectionsFromResult(result: unknown): TailorSection[] {
  const sections = isRecord(result) && Array.isArray(result.sections) ? result.sections : []
  return sections.map(parseSection).filter((section): section is TailorSection => section !== null && !section.omitted)
}

/** Warnings on a finished draft. */
export function warningsFromResult(result: unknown): string[] {
  return isRecord(result) ? stringList(result.warnings) : []
}

/** One section object, or null when its type is unknown. */
function parseSection(value: unknown): TailorSection | null {
  if (!isRecord(value)) return null
  const sectionType = asSectionType(value.section_type)
  if (!sectionType) return null
  return {
    sectionType,
    title: typeof value.title === 'string' ? value.title : SECTION_TITLES[sectionType],
    content: value.content ?? {},
    omitted: value.omitted === true,
  }
}

/** String entries of a list. */
function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** True for a JSON object. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
