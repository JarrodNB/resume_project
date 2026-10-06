/**
 * Description: Collapsible cards on the job page.
 * Index:
 *   - CollapsibleJobCard: a titled card that stays collapsed until opened
 *   - BulletCard: a collapsible list of bullet points
 */
import type { ReactNode } from 'react'
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** A titled card whose body unmounts until the user opens it. */
export function CollapsibleJobCard({ sectionId, title, children }: { sectionId: string; title: string; children: ReactNode }) {
  const { open, toggle, panelId } = useOpenSection(sectionId)

  return (
    <Card>
      <CardHeader>
        <CollapseToggle open={open} panelId={panelId} onToggle={toggle}>
          <CardTitle>{title}</CardTitle>
        </CollapseToggle>
      </CardHeader>
      {open && <CardContent id={panelId}>{children}</CardContent>}
    </Card>
  )
}

/** A titled card listing bullet points. */
export function BulletCard({ sectionId, title, items, emptyText }: { sectionId: string; title: string; items: string[]; emptyText?: string }) {
  return (
    <CollapsibleJobCard sectionId={sectionId} title={title}>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="grid list-disc gap-1.5 pl-5 text-sm">
          {items.map((item, index) => (
            <li key={index}>{item}</li>
          ))}
        </ul>
      )}
    </CollapsibleJobCard>
  )
}
