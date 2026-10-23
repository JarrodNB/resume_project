/** Edits stable bullets and explicitly moves them between shared and role lists. */
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { BULLET_TEXT } from '@/lib/textLimits'

export type DraftBullet = {id?: string; key: string; content: string}
export type BulletScope = {key: string; label: string}

export function ScopedHighlightEditor({label, bullets, onChange, scopes, scopeKey, onMove}: {
  label: string; bullets: DraftBullet[]; onChange: (value: DraftBullet[]) => void
  scopes: BulletScope[]; scopeKey: string; onMove: (bullet: DraftBullet, target: string) => void
}) {
  function move(index: number, direction: number) {
    const next = [...bullets]
    const [bullet] = next.splice(index, 1)
    next.splice(index + direction, 0, bullet)
    onChange(next)
  }
  return <fieldset className="grid min-w-0 gap-2">
    <legend className="mb-2 text-sm font-medium">{label}</legend>
    {bullets.map((bullet, index) => <div key={bullet.key} className="grid min-w-0 gap-2 border-b pb-3">
      <Textarea aria-label={`Highlight ${index + 1}`} rows={2} maxLength={BULLET_TEXT} value={bullet.content}
        onChange={(event) => onChange(bullets.map((item) => item.key === bullet.key ? {...item, content: event.target.value} : item))} />
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs">Applies to
          <select aria-label={`Scope for highlight ${index + 1}`} value={scopeKey} className="ml-2 rounded-md border bg-background p-2 text-sm" onChange={(event) => onMove(bullet, event.target.value)}>
            {scopes.map((scope) => <option key={scope.key} value={scope.key}>{scope.label}</option>)}
          </select>
        </label>
        <Button type="button" variant="ghost" size="sm" disabled={index === 0} aria-label={`Move highlight ${index + 1} up`} onClick={() => move(index, -1)}>Up</Button>
        <Button type="button" variant="ghost" size="sm" disabled={index === bullets.length - 1} aria-label={`Move highlight ${index + 1} down`} onClick={() => move(index, 1)}>Down</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(bullets.filter((item) => item.key !== bullet.key))}>Remove highlight</Button>
      </div>
    </div>)}
    <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={bullets.length >= 40}
      onClick={() => onChange([...bullets, {key: crypto.randomUUID(), content: ''}])}>Add highlight</Button>
  </fieldset>
}
