/**
 * Description: Card wrapper for one section of the parsed resume review form.
 * Index:
 *   - ReviewSection: tone-colored titled card with optional description
 */
import type { ReactNode } from 'react'
import { SectionCard } from '@/components/SectionCard'
import type { SectionTone } from '@/components/sectionTones'

interface ReviewSectionProps {
  tone: SectionTone
  title: string
  description?: string
  children: ReactNode
}

/** Renders a titled card around a group of review fields. */
export function ReviewSection({ tone, title, description, children }: ReviewSectionProps) {
  return (
    <SectionCard tone={tone} title={title} description={description} contentClassName="grid gap-4">
      {children}
    </SectionCard>
  )
}
