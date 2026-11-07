/** Shared resume-section styles, with a distinct icon and accent for each section.
 * Common surface classes live together so a shared style change stays consistent.
 * Accent classes stay written out in full so Tailwind can find them.
 */
import { Award, Briefcase, FileText, FolderKanban, GraduationCap, MessageSquareText, Sparkles, UserRound, type LucideIcon } from 'lucide-react'

export type SectionTone = 'contact' | 'summary' | 'experience' | 'projects' | 'education' | 'certifications' | 'skills' | 'career_contexts'

interface SectionToneStyle {
  card: string
  header: string
  icon: string
  entry: string
  Icon: LucideIcon
}

const SHARED_SECTION_STYLE: Pick<SectionToneStyle, 'card' | 'header' | 'entry'> = {
  card: 'border-border',
  header: 'bg-card',
  entry: 'border-border bg-transparent',
}

export const SECTION_TONES: Record<SectionTone, SectionToneStyle> = {
  contact: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-contact-accent',
    Icon: UserRound,
  },
  summary: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-summary-accent',
    Icon: FileText,
  },
  experience: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-experience-accent',
    Icon: Briefcase,
  },
  projects: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-projects-accent',
    Icon: FolderKanban,
  },
  education: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-education-accent',
    Icon: GraduationCap,
  },
  certifications: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-certifications-accent',
    Icon: Award,
  },
  skills: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-skills-accent',
    Icon: Sparkles,
  },
  career_contexts: {
    ...SHARED_SECTION_STYLE,
    icon: 'text-section-career-context-accent',
    Icon: MessageSquareText,
  },
}
