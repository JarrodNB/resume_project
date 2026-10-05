/**
 * Description: Color tone and icon for each resume section. Class names are written out in full
 * so Tailwind can find them (it can't see classes built from template strings).
 * Index:
 *   - SectionTone: the resume section a piece of UI belongs to
 *   - SECTION_TONES: per-tone classes (card accent, header band, icon, entry tint) and icon
 */
import { Briefcase, FileText, FolderKanban, GraduationCap, MessageSquareText, Sparkles, UserRound, type LucideIcon } from 'lucide-react'

export type SectionTone = 'contact' | 'summary' | 'experience' | 'projects' | 'education' | 'skills' | 'facts'

interface SectionToneStyle {
  card: string
  header: string
  icon: string
  entry: string
  Icon: LucideIcon
}

export const SECTION_TONES: Record<SectionTone, SectionToneStyle> = {
  contact: {
    card: 'border-l-4 border-l-section-contact-accent',
    header: 'bg-section-contact',
    icon: 'text-section-contact-accent',
    entry: 'border-section-contact-accent/25 bg-section-contact/50',
    Icon: UserRound,
  },
  summary: {
    card: 'border-l-4 border-l-section-summary-accent',
    header: 'bg-section-summary',
    icon: 'text-section-summary-accent',
    entry: 'border-section-summary-accent/25 bg-section-summary/50',
    Icon: FileText,
  },
  experience: {
    card: 'border-l-4 border-l-section-experience-accent',
    header: 'bg-section-experience',
    icon: 'text-section-experience-accent',
    entry: 'border-section-experience-accent/25 bg-section-experience/50',
    Icon: Briefcase,
  },
  projects: {
    card: 'border-l-4 border-l-section-projects-accent',
    header: 'bg-section-projects',
    icon: 'text-section-projects-accent',
    entry: 'border-section-projects-accent/25 bg-section-projects/50',
    Icon: FolderKanban,
  },
  education: {
    card: 'border-l-4 border-l-section-education-accent',
    header: 'bg-section-education',
    icon: 'text-section-education-accent',
    entry: 'border-section-education-accent/25 bg-section-education/50',
    Icon: GraduationCap,
  },
  skills: {
    card: 'border-l-4 border-l-section-skills-accent',
    header: 'bg-section-skills',
    icon: 'text-section-skills-accent',
    entry: 'border-section-skills-accent/25 bg-section-skills/50',
    Icon: Sparkles,
  },
  facts: {
    card: 'border-l-4 border-l-section-facts-accent',
    header: 'bg-section-facts',
    icon: 'text-section-facts-accent',
    entry: 'border-section-facts-accent/25 bg-section-facts/50',
    Icon: MessageSquareText,
  },
}
