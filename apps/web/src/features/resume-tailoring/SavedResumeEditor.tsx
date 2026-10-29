/** Show the saved resume first, with a separate view for editing its sections.
 * Drafts live above collapsible cards and follow section IDs across refreshed summary insertion.
 * Missing summaries use explicit proposal review; acceptance refreshes the saved source.
 * Deletion requires confirmation; the route chooses where to return afterward.
 * PDF and DOCX downloads use a saved snapshot; unsaved edits stay preview-only.
 * Save status tracks the submitted snapshot, so edits made during a save stay unsaved.
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
import { asSectionType, SECTION_TITLES } from './sectionOrder'
import { contentFromSectionDraft, sectionDraftFromContent, type SectionDraft } from './tailorDraft'
import { SummaryGenerationPanel } from '@/features/summary-generation/SummaryGenerationPanel'
import { SummaryInclusionControl } from './SummaryInclusionControl'
import { useUpdateResume } from './useUpdateResume'

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
  const dirty = snapshot !== savedSnapshot
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
    editable.map((section) => ({
      sectionType: section.sectionType,
      title: section.title,
      content: contentFromSectionDraft(drafts[section.id] ?? sectionDraftFromContent(section.sectionType, section.content)),
    })),
    summaryIncluded,
  )

  async function save() {
    if (pending || summaryBusy) return
    if (await saveSections(editable.map((section) => ({ id: section.id, content: contentFromSectionDraft(drafts[section.id]) })), summaryIncluded)) {
      setSavedSnapshot(snapshot)
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
      {editing && <fieldset disabled={summaryBusy || deletion.pending} className="resume-section-list">{editable.map((section) => (
        <SectionCard key={section.id} tone={section.sectionType} title={section.title} sectionId={`saved-resume.${resumeId}.${section.id}`}>
          <SectionFields
            draft={drafts[section.id]}
            onChange={(next) => setDrafts((current) => ({ ...current, [section.id]: next }))}
          />
        </SectionCard>
      ))}</fieldset>}
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

/** Saved sections the review fields know how to edit, in stored order. */
function editableSections(sections: SavedResumeSection[]) {
  return [...sections]
    .sort((left, right) => left.position - right.position)
    .flatMap((section) => {
      const sectionType = asSectionType(section.sectionType.toLowerCase())
      if (!sectionType) return []
      return [{ id: section.id, sectionType, title: section.title || SECTION_TITLES[sectionType], content: section.content }]
    })
}

/** Ignore drag keys when comparing saved content; refetches assign fresh UI keys. */
function draftSnapshot(drafts: Record<string, SectionDraft>, summaryIncluded: boolean) {
  return JSON.stringify({ drafts: Object.fromEntries(Object.entries(drafts).map(([id, draft]) => [id, contentFromSectionDraft(draft)])), summaryIncluded })
}
