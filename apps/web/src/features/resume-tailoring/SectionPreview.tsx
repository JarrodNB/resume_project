/**
 * Description: A read-only look at one approved tailored section, with a way to edit it again.
 * Editing again discards every section after it. The text starts collapsed; "Edit again" stays
 * on the header. Entries keep their heading, dates, and bullets instead of one block of text.
 * Index:
 *   - SectionPreview: the section and an "Edit again" button
 */
import { CollapseToggle } from '@/components/CollapseToggle'
import { useOpenSection } from '@/components/useOpenSection'
import { Button } from '@/components/ui/button'
import { SECTION_TITLES } from './sectionOrder'
import { SectionPreviewBody } from './SectionPreviewBody'
import type { TailorSection } from './parseTailorTask'

interface SectionPreviewProps {
  sectionId: string
  section: TailorSection
  onReopen?: (sectionType: TailorSection['sectionType']) => void
  reopening?: boolean
}

/** Shows one decided section. "Edit again" reopens it and drops later sections. */
export function SectionPreview({ sectionId, section, onReopen, reopening = false }: SectionPreviewProps) {
  const { open, toggle, panelId } = useOpenSection(sectionId)
  const title = section.title || SECTION_TITLES[section.sectionType]

  return (
    <section className="grid gap-2 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <CollapseToggle open={open} panelId={panelId} onToggle={toggle} className="min-w-0 flex-1">
          <h2 className="font-medium">{title}</h2>
        </CollapseToggle>
        {onReopen && (
          <Button type="button" variant="ghost" size="sm" disabled={reopening} onClick={() => onReopen(section.sectionType)}>
            Edit again
          </Button>
        )}
      </div>
      {onReopen && <p className="text-xs text-muted-foreground">Editing this again removes every section after it.</p>}
      {open && (
        <div id={panelId}>
          <SectionPreviewBody section={section} />
        </div>
      )}
    </section>
  )
}
