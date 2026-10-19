/**
 * Description: Quiet section surfaces with a distinct icon color for each resume section. Class names are written out in full
 * so Tailwind can find them (it can't see classes built from template strings).
 * Index:
 *   - SectionTone: the resume section a piece of UI belongs to
 *   - SECTION_TONES: per-tone classes (card accent, header band, icon, entry tint) and icon
 */
import { Award, Briefcase, FileText, FolderKanban, GraduationCap, MessageSquareText, Sparkles, UserRound, type LucideIcon } from 'lucide-react'

export type SectionTone = 'contact' | 'summary' | 'experience' | 'projects' | 'education' | 'certifications' | 'skills' | 'facts'

interface SectionToneStyle {
  card: string
  header: string
  icon: string
  entry: string
  Icon: LucideIcon
}

export const SECTION_TONES: Record<SectionTone, SectionToneStyle> = {
  contact: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-contact-accent',
    entry: 'border-border bg-transparent',
    Icon: UserRound,
  },
  summary: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-summary-accent',
    entry: 'border-border bg-transparent',
    Icon: FileText,
  },
  experience: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-experience-accent',
    entry: 'border-border bg-transparent',
    Icon: Briefcase,
  },
  projects: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-projects-accent',
    entry: 'border-border bg-transparent',
    Icon: FolderKanban,
  },
  education: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-education-accent',
    entry: 'border-border bg-transparent',
    Icon: GraduationCap,
  },
  certifications: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-certifications-accent',
    entry: 'border-border bg-transparent',
    Icon: Award,
  },
  skills: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-skills-accent',
    entry: 'border-border bg-transparent',
    Icon: Sparkles,
  },
  facts: {
    card: 'border-border',
    header: 'bg-card',
    icon: 'text-section-facts-accent',
    entry: 'border-border bg-transparent',
    Icon: MessageSquareText,
  },
}
