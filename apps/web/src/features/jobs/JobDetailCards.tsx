/**
 * Description: A collapsible card for long job content, such as the full description.
 * Index:
 *   - CollapsibleJobCard: a titled card that stays collapsed until opened
 */
import type { ReactNode } from 'react'
import { CollapsePanel } from '@/components/CollapsePanel'
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
      <CollapsePanel open={open} id={panelId}><CardContent>{children}</CardContent></CollapsePanel>
    </Card>
  )
}
