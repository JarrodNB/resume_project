/** A remembered, collapsed home for the user's reusable next-job preferences. */
import { Plus, X } from 'lucide-react'
import { SectionCard } from '@/components/SectionCard'
import { useState } from 'react'
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
  return <div className="grid gap-4">
    {preferences.loading && <p role="status">Loading preferences…</p>}
    <ErrorAlert title="Couldn't update preferences" messages={preferences.errors} />
    {preferences.errors.length > 0 && <Button type="button" variant="outline" disabled={preferences.busy} onClick={() => void preferences.reload()}>Reload preferences</Button>}
    {preferences.profile && <>
      <PreferenceEditor key={preferences.profile.version} profile={preferences.profile} busy={preferences.busy || preferences.loading} update={preferences.update} />
    </>}
  </div>
}

function PreferenceEditor({ profile, busy, update }: { profile: Profile; busy: boolean; update: ReturnType<typeof useJobPreferences>['update'] }) {
  const saved = profile.draftCriteria.map(({ id, text, priority }) => ({ id, text, priority }))
  const [criteria, setCriteria] = useState<Criterion[]>(saved)
  const dirty = JSON.stringify(criteria) !== JSON.stringify(saved)
  const invalid = criteria.some((criterion) => !criterion.text.trim())
  const pendingConfirmation = profile.version > profile.confirmedRevision

  function edit(index: number, attributes: Partial<Criterion>) {
    setCriteria((current) => current.map((criterion, i) => i === index ? { ...criterion, ...attributes } : criterion))
  }

  return <div className="preference-editor">
    <p className="preference-help">Add up to 10 preferences. Mark what’s essential, save your draft, then confirm it for job checks.</p>
    <fieldset disabled={busy} className="preference-fields">
      <legend className="sr-only">Edit next-job preferences</legend>
      {criteria.map((criterion, index) => <div className="preference-row" key={criterion.id ?? `new-${index}`}>
        <div className="preference-text">
          <Label htmlFor={`preference-${index}`}>Preference {index + 1}</Label>
          <Input id={`preference-${index}`} placeholder="For example, fully remote within the US" value={criterion.text} maxLength={500} onChange={(event) => edit(index, { text: event.target.value })} />
        </div>
        <div className="preference-priority">
          <Label htmlFor={`preference-priority-${index}`}>Priority <span className="sr-only">{index + 1}</span></Label>
          <select id={`preference-priority-${index}`} className="preference-select" value={criterion.priority} onChange={(event) => edit(index, { priority: event.target.value })}>
            <option value="must_have">Must-have</option><option value="nice_to_have">Nice-to-have</option>
          </select>
        </div>
        <Button type="button" variant="ghost" size="icon" className="preference-remove" aria-label={`Remove preference ${index + 1}`} onClick={() => setCriteria((current) => current.filter((_, i) => i !== index))}><X aria-hidden /></Button>
      </div>)}
      <div className="preference-actions">
        <Button type="button" variant="outline" disabled={criteria.length >= 10} onClick={() => setCriteria((current) => [...current, { text: '', priority: 'must_have' }])}><Plus aria-hidden />Add preference</Button>
        <Button type="button" variant={dirty ? 'default' : 'outline'} disabled={!dirty || invalid} onClick={() => void update('save', criteria)}>Save draft</Button>
        <Button type="button" variant={!dirty && pendingConfirmation ? 'default' : 'outline'} disabled={dirty || !pendingConfirmation} onClick={() => void update('confirm')}>Confirm saved preferences</Button>
      </div>
    </fieldset>
    {busy && <p role="status">Saving preferences…</p>}
    {dirty ? <p role="status">Unsaved draft. Confirmed preferences stay in use until you save and confirm changes.</p>
      : pendingConfirmation ? <p role="status">Draft saved. Confirm it when it reflects what you want.</p>
        : profile.confirmedCriteria.length > 0 ? <p role="status">Confirmed preferences are ready to reuse in later searches.</p>
          : <p>No confirmed preferences. Checks stay off until you confirm what you want.</p>}
    {profile.confirmedCriteria.length > 0 && <div className="preference-confirmed">
      <h3 className="font-semibold">Confirmed preferences</h3>
      <ul aria-label="Confirmed preferences" className="grid gap-1">{profile.confirmedCriteria.map((criterion) => <li key={criterion.id}>{criterion.text} <span className="text-muted-foreground">· {criterion.priority === 'must_have' ? 'Must-have' : 'Nice-to-have'}</span></li>)}</ul>
    </div>}
    {(profile.draftCriteria.length > 0 || profile.confirmedCriteria.length > 0) && <Button type="button" variant="ghost" disabled={busy} className="preference-clear" onClick={() => void update('clear')}>Clear all preferences</Button>}
  </div>
}
