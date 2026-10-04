/**
 * Description: Card for one resume section, colored by its tone: accent stripe on the left and a
 * tinted header band with the section icon.
 * Index:
 *   - SectionCard: titled, tone-colored card with optional badge and description
 */
import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { SECTION_TONES, type SectionTone } from './sectionTones'

interface SectionCardProps {
  tone: SectionTone
  title: string
  /** Shown next to the title (e.g. an entry count). */
  badge?: ReactNode
  description?: string
  contentClassName?: string
  children: ReactNode
}

/** Renders a section card in its tone's colors. */
export function SectionCard({ tone, title, badge, description, contentClassName, children }: SectionCardProps) {
  const style = SECTION_TONES[tone]

  return (
    <Card className={cn('pt-0', style.card)}>
      <CardHeader className={cn('border-b py-3', style.header)}>
        <div className="flex items-center gap-2">
          <style.Icon className={cn('size-4', style.icon)} aria-hidden />
          <CardTitle className="text-lg">{title}</CardTitle>
          {badge}
        </div>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}
