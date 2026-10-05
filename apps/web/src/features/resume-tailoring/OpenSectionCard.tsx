/**
 * Description: The section currently waiting on the user: its editor, a blocked-edit refusal,
 * and the choice to continue, leave it out, or write it anyway.
 * Index:
 *   - OpenSectionCard: editor for one paused section
 */
import { useState } from 'react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { Button } from '@/components/ui/button'
import type { OpenSection } from './parseTailorTask'
import { SectionFields } from './SectionFields'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'
import type { TailorSectionType } from './sectionOrder'

interface OpenSectionCardProps {
  open: OpenSection
  pending: boolean
  errors: string[]
  onAction: (sectionType: TailorSectionType, action: string, content: Record<string, unknown>) => void
}

/** Edits the open section. A blocked edit stays here until the text is changed. */
export function OpenSectionCard({ open, pending, errors, onAction }: OpenSectionCardProps) {
  const [draft, setDraft] = useState<SectionDraft>(() => sectionDraftFromContent(open.sectionType, open.content))

  return (
    <section className="grid gap-4 rounded-lg border p-4">
      <h2 className="font-medium">{open.title}</h2>
      {open.warnings.map((warning) => (
        <p key={warning} className="text-sm text-muted-foreground">
          {warning}
        </p>
      ))}
      {open.blocked && <ErrorAlert title="That edit can't be used" messages={[open.message ?? 'Change it and try again.']} />}
      {open.nothingFits && (
        <p className="text-sm text-muted-foreground">Nothing in your library fits this section. Leave it out, or write it from your library anyway.</p>
      )}
      <ErrorAlert messages={errors} title="Couldn't continue" />
      <SectionFields draft={draft} onChange={setDraft} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={pending} onClick={() => onAction(open.sectionType, 'approve', contentFromSectionDraft(draft))}>
          Use this and continue
        </Button>
        {open.nothingFits && (
          <>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onAction(open.sectionType, 'omit', {})}>
              Leave this section out
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => onAction(open.sectionType, 'write_anyway', {})}>
              Write it from my library anyway
            </Button>
          </>
        )}
      </div>
    </section>
  )
}
