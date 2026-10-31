/**
 * Description: Card for one resume section, colored by its tone: a quiet surface and a
 * recognizable section icon. Pass `sectionId` to remember whether it is open.
 * Index:
 *   - SectionCard: titled, tone-colored card with optional badge, description, and collapse
 *   - CollapsibleSectionCard: the same card, collapsed until its section id is opened
 *   - SectionCardFrame: the card markup shared by both
 */
import type { ReactNode } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import { CollapsePanel } from './CollapsePanel'
import { CollapseToggle } from './CollapseToggle'
import { SECTION_TONES, type SectionTone } from './sectionTones'
import { useOpenSection } from './useOpenSection'

interface SectionCardProps {
  tone: SectionTone
  title: string
  /** Shown next to the title (e.g. an entry count). */
  badge?: ReactNode
  description?: string
  contentClassName?: string
  /** When set, the card starts collapsed and stays that way until opened again. */
  sectionId?: string
  children: ReactNode
}

/** Renders a section card in its tone's colors. With a section id, the body starts collapsed. */
export function SectionCard({ sectionId, ...props }: SectionCardProps) {
  if (sectionId !== undefined) return <CollapsibleSectionCard sectionId={sectionId} {...props} />
  return <SectionCardFrame {...props} open />
}

/** A section card whose body unmounts until the user opens it. */
function CollapsibleSectionCard({ sectionId, ...props }: SectionCardProps & { sectionId: string }) {
  const { open, toggle, panelId } = useOpenSection(sectionId)
  return <SectionCardFrame {...props} open={open} toggle={toggle} panelId={panelId} />
}

/** The tone-colored card. A toggle replaces the plain heading when `toggle` is set. */
function SectionCardFrame({
  tone,
  title,
  badge,
  description,
  contentClassName,
  children,
  open,
  toggle,
  panelId,
}: Omit<SectionCardProps, 'sectionId'> & { open: boolean; toggle?: () => void; panelId?: string }) {
  const style = SECTION_TONES[tone]
  const heading = (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <style.Icon className={cn('size-4', style.icon)} aria-hidden />
      <CardTitle className="text-base">{title}</CardTitle>
      {badge}
    </div>
  )

  return (
    <Card className={cn('section-card gap-0 py-0 shadow-none', style.card)}>
      <CardHeader className={cn('px-5 py-5', style.header, open && 'border-b')}>
        {toggle && panelId ? (
          <CollapseToggle open={open} panelId={panelId} onToggle={toggle}>
            {heading}
          </CollapseToggle>
        ) : (
          heading
        )}
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CollapsePanel open={open} id={panelId}>
        <CardContent className={cn('px-5 py-5', contentClassName)}>
          {children}
        </CardContent>
      </CollapsePanel>
    </Card>
  )
}
