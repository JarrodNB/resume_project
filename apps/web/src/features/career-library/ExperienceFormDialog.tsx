/** Edits one employment block, its ordered titles, and stable scoped bullets together. */
import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { CREATE_EXPERIENCE_MUTATION, UPDATE_EXPERIENCE_MUTATION } from './careerLibrarySaveMutations'
import { EntryFormDialog } from './EntryFormDialog'
import { blankToNull } from './libraryFormValues'
import { PROSE_TEXT, SHORT_TEXT } from '@/lib/textLimits'
import { LibraryField } from './LibraryField'
import { useSaveLibraryRecord } from './useSaveLibraryRecord'
import { ScopedHighlightEditor, type DraftBullet } from './ScopedHighlightEditor'

type Experience = CareerLibraryQuery['experiences'][number]
type DraftRole = {id?: string; key: string; title: string; startDate: string; endDate: string; current: boolean; description: string; highlights: DraftBullet[]}
const blankRole = (): DraftRole => ({key: crypto.randomUUID(), title: '', startDate: '', endDate: '', current: true, description: '', highlights: []})
const bulletInput = (bullets: DraftBullet[]) => bullets.filter((bullet) => bullet.content.trim()).map(({id, content}) => ({...(id ? {id} : {}), content: content.trim()}))

export function ExperienceFormDialog({open, onOpenChange, experience}: {
  open: boolean; onOpenChange: (open: boolean) => void; experience: Experience | null
}) {
  if (!open) return null
  return <ExperienceForm key={experience?.id ?? 'new'} experience={experience} onClose={() => onOpenChange(false)} />
}

function ExperienceForm({experience, onClose}: {experience: Experience | null; onClose: () => void}) {
  const {save, busy, errors} = useSaveLibraryRecord()
  const currentId = useId()
  const [company, setCompany] = useState(experience?.company ?? '')
  const [location, setLocation] = useState(experience?.location ?? '')
  const [description, setDescription] = useState(experience?.description ?? '')
  const [roles, setRoles] = useState<DraftRole[]>(() => experience?.roles?.length ? experience.roles.map((role) => ({
    id: role.id, key: role.id, title: role.title, startDate: role.startDate ?? '', endDate: role.endDate ?? '', current: role.endDate == null,
    description: role.description ?? '', highlights: experience.highlights.filter((bullet) => bullet.experienceRoleId === role.id).map((bullet) => ({...bullet, key: bullet.id})),
  })) : [{...blankRole(), title: experience?.title ?? '', startDate: experience?.startDate ?? '', endDate: experience?.endDate ?? '',
    highlights: experience?.highlights.map((bullet) => ({...bullet, key: bullet.id})) ?? []}])
  const [shared, setShared] = useState<DraftBullet[]>(() => experience?.roles?.length ? experience.highlights.filter((bullet) => !bullet.experienceRoleId).map((bullet) => ({...bullet, key: bullet.id})) : [])
  const scopes = [{key: 'shared', label: 'Shared highlights'}, ...roles.map((role, index) => ({key: role.key, label: role.title || `Role ${index + 1}`}))]
  function editRole(key: string, edits: Partial<DraftRole>) { setRoles((previous) => previous.map((role) => role.key === key ? {...role, ...edits} : role)) }
  function moveBullet(bullet: DraftBullet, target: string) {
    setShared((previous) => [...previous.filter((item) => item.key !== bullet.key), ...(target === 'shared' ? [bullet] : [])])
    setRoles((previous) => previous.map((role) => ({...role, highlights: [...role.highlights.filter((item) => item.key !== bullet.key), ...(target === role.key ? [bullet] : [])]})))
  }
  function reorderRole(index: number, direction: number) {
    const next = [...roles]
    const [role] = next.splice(index, 1)
    next.splice(index + direction, 0, role)
    setRoles(next)
  }
  async function submit() {
    const retainedIds = new Set([...roles.flatMap((role) => bulletInput(role.highlights)), ...bulletInput(shared)].map((bullet) => bullet.id))
    const removedIds = experience?.highlights.filter((bullet) => !retainedIds.has(bullet.id)).map((bullet) => bullet.id) ?? []
    const saved = await save(experience ? UPDATE_EXPERIENCE_MUTATION : CREATE_EXPERIENCE_MUTATION, {
      ...(experience ? {id: experience.id} : {}), attributes: {
        company: company.trim(), location: blankToNull(location), description: blankToNull(description),
        roles: roles.map((role) => ({...(role.id ? {id: role.id} : {}), title: role.title.trim(), startDate: blankToNull(role.startDate),
          endDate: role.current ? null : blankToNull(role.endDate), description: blankToNull(role.description), highlights: bulletInput(role.highlights)})),
        sharedHighlights: bulletInput(shared),
        ...(removedIds.length ? {removedHighlightIds: removedIds} : {}),
      },
    })
    if (saved) onClose()
  }
  return <EntryFormDialog open onOpenChange={(next) => !next && onClose()} title={experience ? 'Edit experience' : 'Add experience'}
    description="Keep titles together when they belong to the same experience. Shared highlights apply to the whole entry." onSubmit={submit} busy={busy} errors={errors}>
    <div className="grid gap-4 sm:grid-cols-2">
      <LibraryField label="Company" required value={company} onChange={setCompany} maxLength={SHORT_TEXT} />
      <LibraryField label="Location" value={location} onChange={setLocation} maxLength={SHORT_TEXT} />
    </div>
    <LibraryField label="Description" multiline value={description} onChange={setDescription} maxLength={PROSE_TEXT} />
    {roles.map((role, index) => <fieldset key={role.key} className="grid min-w-0 gap-4 border-t pt-4">
      <legend className="text-sm font-medium">{roles.length > 1 ? `Role ${index + 1}` : 'Role'}</legend>
      <LibraryField label="Title" required value={role.title} onChange={(title) => editRole(role.key, {title})} maxLength={SHORT_TEXT} />
      <div className="grid gap-4 sm:grid-cols-2">
        <LibraryField label="Start" type="date" value={role.startDate} onChange={(startDate) => editRole(role.key, {startDate})} />
        <LibraryField label="End" type="date" value={role.endDate} disabled={role.current} onChange={(endDate) => editRole(role.key, {endDate})} />
      </div>
      <div className="flex items-center gap-2"><Checkbox id={`${currentId}-${role.key}`} checked={role.current}
        onCheckedChange={(checked) => editRole(role.key, {current: checked === true, ...(checked === true ? {endDate: ''} : {})})} />
        <Label htmlFor={`${currentId}-${role.key}`}>Current role</Label></div>
      <LibraryField label="Role description" multiline value={role.description} onChange={(value) => editRole(role.key, {description: value})} maxLength={PROSE_TEXT} />
      <ScopedHighlightEditor label={roles.length === 1 ? 'Highlights' : `${role.title || `Role ${index + 1}`} highlights`} bullets={role.highlights} onChange={(highlights) => editRole(role.key, {highlights})} scopes={scopes} scopeKey={role.key} onMove={moveBullet} />
      {roles.length > 1 && <div className="flex flex-wrap gap-2">
        <Button type="button" variant="ghost" disabled={index === 0} onClick={() => reorderRole(index, -1)}>Move role up</Button>
        <Button type="button" variant="ghost" disabled={index === roles.length - 1} onClick={() => reorderRole(index, 1)}>Move role down</Button>
        <Button type="button" variant="ghost" disabled={role.highlights.length > 0} onClick={() => setRoles(roles.filter((item) => item.key !== role.key))}>Remove role</Button>
        {role.highlights.length > 0 && <p className="text-xs text-muted-foreground">Move or remove its highlights before removing this role.</p>}
      </div>}
    </fieldset>)}
    <Button type="button" variant="outline" className="justify-self-start" disabled={roles.length >= 20} onClick={() => setRoles([...roles, blankRole()])}>Add role</Button>
    <ScopedHighlightEditor label="Shared highlights" bullets={shared} onChange={setShared} scopes={scopes} scopeKey="shared" onMove={moveBullet} />
  </EntryFormDialog>
}
