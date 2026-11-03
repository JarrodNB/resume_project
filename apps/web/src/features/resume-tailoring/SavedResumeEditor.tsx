/** Show the saved resume first, with a separate view for editing its sections.
 * Drafts live above collapsible cards and follow section IDs across refreshed summary insertion.
 * Missing summaries use explicit proposal review; acceptance refreshes the saved source.
 * Deletion requires confirmation; the route chooses where to return afterward.
 * PDF and DOCX downloads use a saved snapshot; unsaved edits stay preview-only.
 * Save status tracks the submitted snapshot, so edits made during a save stay unsaved.
 * Sections can be dragged; contact stays first. A new order saves with Save, like an edit.
 */
import { useMemo, useRef, useState } from 'react'
import { Download, Trash2 } from 'lucide-react'
import { ErrorAlert } from '@/components/ErrorAlert'
import { downloadResumeDocx, downloadResumePdf } from './resumeDownload'
import { Button } from '@/components/ui/button'
import { DeleteResumeDialog } from '@/features/resumes/DeleteResumeDialog'
import { useDeleteResume } from '@/features/resumes/useDeleteResume'
import { SectionCard } from '@/components/SectionCard'
import { ResumeEditorActions } from './ResumeEditorActions'
import { ResumeUnsavedChanges } from './ResumeUnsavedChanges'
import { SectionFields } from './SectionFields'
import { ResumePdfPreview } from './ResumePdfPreview'
import { buildResumePdfModel } from './resumePdfModel'
import { ResumeSectionList } from './ResumeSectionList'
import { asSectionType, SECTION_TITLES } from './sectionOrder'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'
import { SummaryGenerationPanel } from '@/features/summary-generation/SummaryGenerationPanel'
import { SummaryInclusionControl } from './SummaryInclusionControl'
import { useUpdateResume } from './useUpdateResume'
import { UseSectionOrderAsDefault } from './UseSectionOrderAsDefault'

interface SavedResumeSection {
  id: string
  sectionType: string
  title: string
  position: number
  content: unknown
}

/** Edits one saved resume. Preview shows the current draft at actual size. */
export function SavedResumeEditor({ resumeId, title = '', sections, includeSummary = true, jobId, onDeleted, onSummaryAccepted }: { resumeId: string; title?: string; sections: SavedResumeSection[]; includeSummary?: boolean; jobId?: string; onDeleted: () => void; onSummaryAccepted?: () => void | Promise<unknown> }) {
  const editable = useMemo(() => editableSections(sections), [sections])
  const incomingDrafts = useMemo(() => Object.fromEntries(editable.map((section) => [section.id, sectionDraftFromContent(section.sectionType, section.content)])), [editable])
  const [drafts, setDrafts] = useState<Record<string, SectionDraft>>(incomingDrafts)
  const incomingOrder = editable.map((section) => section.id)
  const [order, setOrder] = useState(incomingOrder)
  const [savedOrder, setSavedOrder] = useState(incomingOrder)
  const [summaryIncluded, setSummaryIncluded] = useState(includeSummary)
  const [savedSnapshot, setSavedSnapshot] = useState(() => draftSnapshot(drafts, summaryIncluded))
  const [savedModel, setSavedModel] = useState(() => buildResumePdfModel(editable, summaryIncluded))
  const sourceVersion = JSON.stringify({ editable, includeSummary })
  const [previousSource, setPreviousSource] = useState(sourceVersion)
  const [summaryBusy, setSummaryBusy] = useState(false)
  if (previousSource !== sourceVersion) {
    const baseline = JSON.parse(savedSnapshot) as { drafts: Record<string, unknown>; summaryIncluded: boolean }
    // Refresh clean fields while keeping any local edits attached to their section IDs.
    const next = Object.fromEntries(editable.map((section) => [section.id,
      drafts[section.id] && JSON.stringify(contentFromSectionDraft(drafts[section.id])) !== JSON.stringify(baseline.drafts[section.id]) ? drafts[section.id] : incomingDrafts[section.id],
    ]))
    setDrafts(next)
    // Keep an unsaved order, and let any new section land where the server put it.
    if (order.join() !== savedOrder.join()) setOrder(mergeSectionOrder(order, incomingOrder))
    else setOrder(incomingOrder)
    setSavedOrder(incomingOrder)
    if (summaryIncluded === baseline.summaryIncluded) setSummaryIncluded(includeSummary)
    setSavedSnapshot(draftSnapshot(incomingDrafts, includeSummary))
    setSavedModel(buildResumePdfModel(editable, includeSummary))
    setPreviousSource(sourceVersion)
  }
  const deleted = useRef(false)
  const exporting = useRef(false)
  const [exportPending, setExportPending] = useState<'PDF' | 'DOCX' | null>(null)
  const [exportError, setExportError] = useState<string[]>([])
  const snapshot = draftSnapshot(drafts, summaryIncluded)
  const orderChanged = order.join() !== savedOrder.join()
  const dirty = snapshot !== savedSnapshot || orderChanged
  const ordered = order.flatMap((id) => editable.find((section) => section.id === id) ?? [])
  const [editing, setEditing] = useState(false)
  const { saveSections, errors, pending } = useUpdateResume(resumeId)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deletion = useDeleteResume(resumeId, jobId)

  async function confirmDelete() {
    if (await deletion.deleteResume()) {
      deleted.current = true
      onDeleted()
    }
  }
  const model = buildResumePdfModel(
    ordered.map((section) => ({
      sectionType: section.sectionType,
      title: section.title,
      content: contentFromSectionDraft(drafts[section.id] ?? sectionDraftFromContent(section.sectionType, section.content)),
    })),
    summaryIncluded,
  )

  async function save() {
    if (pending || summaryBusy) return
    // The server needs every section; any this editor can't show keep their place at the end.
    const hiddenIds = sections.map((section) => section.id).filter((id) => !order.includes(id))
    if (await saveSections(editable.map((section) => ({ id: section.id, content: contentFromSectionDraft(drafts[section.id]) })), summaryIncluded, orderChanged ? [...order, ...hiddenIds] : undefined)) {
      setSavedSnapshot(snapshot)
      setSavedOrder(order)
      setSavedModel(model)
    }
  }

  async function download(format: 'PDF' | 'DOCX') {
    if (dirty || pending || summaryBusy || deletion.pending || exporting.current) return
    exporting.current = true
    setExportPending(format)
    setExportError([])
    // Later edits build a different model and cannot change this saved snapshot.
    try {
      await (format === 'PDF' ? downloadResumePdf : downloadResumeDocx)(savedModel, title)
    } catch {
      setExportError([`Could not download the ${format}. Please try again.`])
    } finally {
      exporting.current = false
      setExportPending(null)
    }
  }

  return (
    <div className="resume-editor">
      <ResumeUnsavedChanges dirty={dirty} discarded={deleted} />
      <ResumeEditorActions editing={editing} pending={pending} dirty={dirty} disabled={summaryBusy || deletion.pending || !!exportPending} errors={errors} onPreview={() => setEditing(false)} onEdit={() => setEditing(true)} onSave={() => void save()}>
        {(['PDF', 'DOCX'] as const).map((format) => (
          <Button key={format} type="button" variant="outline" disabled={dirty || pending || summaryBusy || deletion.pending || !!exportPending} onClick={() => void download(format)}>
            <Download aria-hidden /> {exportPending === format ? `Preparing ${format}…` : `Download ${format}`}
          </Button>
        ))}
      </ResumeEditorActions>
      {dirty && <p className="text-sm text-muted-foreground">Save your changes to download</p>}
      <ErrorAlert messages={exportError} title="Couldn't download this resume" />
      <DeleteResumeDialog open={deleteOpen} onOpenChange={setDeleteOpen} onConfirm={() => void confirmDelete()} pending={deletion.pending} errors={deletion.errors} />
      {editing && <SummaryInclusionControl checked={summaryIncluded} onChange={setSummaryIncluded} disabled={pending || summaryBusy || deletion.pending || !!exportPending} />}
      {editing && <UseSectionOrderAsDefault resumeOrder={ordered.map((section) => section.sectionType)} disabled={pending || summaryBusy || deletion.pending} />}
      {editing && <fieldset disabled={summaryBusy || deletion.pending} className="min-w-0"><div className="resume-section-list">
        <ResumeSectionList
          sections={ordered}
          idOf={(section) => section.id}
          typeOf={(section) => section.sectionType}
          titleOf={(section) => section.title}
          onReorder={(movableIds) => setOrder([...ordered.filter((section) => section.sectionType === 'contact').map((section) => section.id), ...movableIds])}
          renderSection={(section, dragHandle) => (
            <SectionCard tone={section.sectionType} title={section.title} sectionId={`saved-resume.${resumeId}.${section.id}`} dragHandle={dragHandle}>
              <SectionFields
                draft={drafts[section.id]}
                onChange={(next) => setDrafts((current) => ({ ...current, [section.id]: next }))}
              />
            </SectionCard>
          )}
        />
      </div></fieldset>}
      {!editable.some((section) => {
        const draft = incomingDrafts[section.id]
        return section.sectionType === 'summary' && draft?.kind === 'summary' && draft.text?.trim()
      }) && <div className="grid gap-2">
        {dirty && <p className="text-sm text-muted-foreground">Save your changes before generating or accepting a summary.</p>}
        <SummaryGenerationPanel targetKind="resume" targetId={resumeId} disabled={dirty || pending || deletion.pending || !!exportPending} onBusyChange={setSummaryBusy} onAccepted={onSummaryAccepted} />
      </div>}
      {!editing && (
        <div className="resume-preview-stage">
          <ResumePdfPreview model={model} />
        </div>
      )}
      <div className="resume-delete-action">
        <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" disabled={pending || summaryBusy || deletion.pending || !!exportPending} onClick={() => setDeleteOpen(true)}><Trash2 aria-hidden /> Delete resume</Button>
      </div>
    </div>
  )
}

/** Saved sections the review fields know how to edit, in stored order with contact first. */
function editableSections(sections: SavedResumeSection[]) {
  const stored = [...sections]
    .sort((left, right) => left.position - right.position)
    .flatMap((section) => {
      const sectionType = asSectionType(section.sectionType.toLowerCase())
      if (!sectionType) return []
      return [{ id: section.id, sectionType, title: section.title || SECTION_TITLES[sectionType], content: section.content }]
    })
  return stored.filter((section) => section.sectionType === 'contact').concat(stored.filter((section) => section.sectionType !== 'contact'))
}

/** The local order with removed sections dropped and new ones placed as the server has them. */
function mergeSectionOrder(local: string[], incoming: string[]) {
  const merged = local.filter((id) => incoming.includes(id))
  incoming.forEach((id, index) => {
    if (!merged.includes(id)) merged.splice(index, 0, id)
  })
  return merged
}

/**
 * Ignore drag keys when comparing saved content; refetches assign fresh UI keys.
 * Sections are compared by ID, because a refetch after reordering rebuilds them in a new order.
 */
function draftSnapshot(drafts: Record<string, SectionDraft>, summaryIncluded: boolean) {
  const content = Object.entries(drafts).sort(([left], [right]) => left.localeCompare(right)).map(([id, draft]) => [id, contentFromSectionDraft(draft)])
  return JSON.stringify({ drafts: Object.fromEntries(content), summaryIncluded })
}
