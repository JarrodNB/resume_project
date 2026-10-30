/** A remembered, collapsed home for the user's reusable next-job preferences. */
import { SectionCard } from '@/components/SectionCard'
import { useEffect, useState } from 'react'
import { JobPreferenceConversation } from './JobPreferenceConversation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useJobPreferences } from './useJobPreferences'
import type { JobPreferencesQuery } from '@/graphql/generated/graphql'

type Profile = JobPreferencesQuery['jobPreferences']
type Criterion = { id?: string; text: string; priority: string }

export function JobPreferences() {
  return <SectionCard tone="career_contexts" title="What I want next" sectionId="job-preferences" description="Keep must-haves and nice-to-haves for your next job.">
    <PreferenceContents />
  </SectionCard>
}

function PreferenceContents() {
  const preferences = useJobPreferences()
  const [dirty, setDirty] = useState(false)
  const [conversationBusy, setConversationBusy] = useState(false)
  return <div className="grid gap-4">
    {preferences.loading && <p role="status">Loading preferences…</p>}
    <ErrorAlert title="Couldn't update preferences" messages={preferences.errors} />
    {preferences.errors.length > 0 && <Button type="button" variant="outline" disabled={preferences.busy} onClick={() => void preferences.reload()}>Reload preferences</Button>}
    {preferences.profile && <>
      <JobPreferenceConversation version={preferences.profile.version} disabled={dirty || preferences.busy || preferences.loading} onBusyChange={setConversationBusy} onAccepted={preferences.reload} />
      <PreferenceEditor key={preferences.profile.version} profile={preferences.profile} busy={preferences.busy || preferences.loading || conversationBusy} update={preferences.update} onDirtyChange={setDirty} />
    </>}
  </div>
}

function PreferenceEditor({ profile, busy, update, onDirtyChange }: { profile: Profile; busy: boolean; onDirtyChange: (dirty: boolean) => void; update: ReturnType<typeof useJobPreferences>['update'] }) {
  const saved = profile.draftCriteria.map(({ id, text, priority }) => ({ id, text, priority }))
  const [criteria, setCriteria] = useState<Criterion[]>(saved)
  const dirty = JSON.stringify(criteria) !== JSON.stringify(saved)
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  const invalid = criteria.some((criterion) => !criterion.text.trim())
  const pendingConfirmation = profile.version > profile.confirmedRevision

  function edit(index: number, attributes: Partial<Criterion>) {
    setCriteria((current) => current.map((criterion, i) => i === index ? { ...criterion, ...attributes } : criterion))
  }

  return <div className="grid gap-4">
    <p>Save up to 10 preferences. Must-haves matter most; nice-to-haves are a bonus. Save your draft, then confirm it.</p>
    <fieldset disabled={busy} className="grid gap-4">
      <legend className="sr-only">Edit next-job preferences</legend>
      {criteria.map((criterion, index) => <div className="grid gap-2 rounded border p-3" key={criterion.id ?? `new-${index}`}>
        <Label htmlFor={`preference-${index}`}>Preference {index + 1}</Label>
        <Input id={`preference-${index}`} value={criterion.text} maxLength={500} onChange={(event) => edit(index, { text: event.target.value })} />
        <div className="flex flex-wrap items-center gap-3">
          <Label htmlFor={`preference-priority-${index}`}>Priority {index + 1}</Label>
          <select id={`preference-priority-${index}`} className="rounded border bg-background px-3 py-2 text-sm" value={criterion.priority} onChange={(event) => edit(index, { priority: event.target.value })}>
            <option value="must_have">Must-have</option><option value="nice_to_have">Nice-to-have</option>
          </select>
          <Button type="button" variant="ghost" aria-label={`Remove preference ${index + 1}`} onClick={() => setCriteria((current) => current.filter((_, i) => i !== index))}>Remove</Button>
        </div>
      </div>)}
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={criteria.length >= 10} onClick={() => setCriteria((current) => [...current, { text: '', priority: 'must_have' }])}>Add preference</Button>
        <Button type="button" disabled={!dirty || invalid} onClick={() => void update('save', criteria)}>Save draft</Button>
        <Button type="button" disabled={dirty || !pendingConfirmation} onClick={() => void update('confirm')}>Confirm saved preferences</Button>
      </div>
    </fieldset>
    {busy && <p role="status">Saving preferences…</p>}
    {dirty ? <p role="status">Unsaved draft. Confirmed preferences stay in use until you save and confirm changes.</p>
      : pendingConfirmation ? <p role="status">Draft saved. Confirm it when it reflects what you want.</p>
        : profile.confirmedCriteria.length > 0 ? <p role="status">Confirmed preferences are ready to reuse in later searches.</p>
          : <p>No confirmed preferences. Checks stay off until you confirm what you want.</p>}
    {profile.confirmedCriteria.length > 0 && <div className="grid gap-2">
      <h3 className="font-semibold">Confirmed preferences</h3>
      <ul aria-label="Confirmed preferences" className="grid gap-1">{profile.confirmedCriteria.map((criterion) => <li key={criterion.id}>{criterion.text} <span className="text-muted-foreground">· {criterion.priority === 'must_have' ? 'Must-have' : 'Nice-to-have'}</span></li>)}</ul>
    </div>}
    {(profile.draftCriteria.length > 0 || profile.confirmedCriteria.length > 0) && <Button type="button" variant="outline" disabled={busy} className="justify-self-start" onClick={() => void update('clear')}>Clear all preferences</Button>}
  </div>
}
