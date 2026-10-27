/** Resolve a typed place into a US city/state choice before submitting a search.
 * Request generations discard responses for text the user has already changed.
 */
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ErrorAlert } from '@/components/ErrorAlert'
import { useJobBoardLocations } from './useJobBoardLocations'
export type LocationChoice = { kind: string; providerId: number; label: string }
export function JobBoardLocationPicker({ onChange }: { onChange: (choice: LocationChoice | null, unresolved: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [selected, setSelected] = useState<LocationChoice | null>(null)
  const { choices, loading, searched, errors, reset, findLocations } = useJobBoardLocations()
  function change(value: string) {
    reset()
    setText(value)
    setSelected(null)
    onChange(null, Boolean(value.trim()))
  }
  return <div className="board-location-picker">
    <Label htmlFor="board-location">US city or state</Label>
    <div className="board-location-field">
      <Input ref={input} id="board-location" value={text} maxLength={100} placeholder="Anywhere in the US" aria-describedby="board-location-help" onChange={(event) => change(event.target.value)} />
      {selected ? <Button type="button" variant="outline" onClick={() => change('')}>Clear location</Button> :
        <Button type="button" variant="outline" disabled={text.trim().length < 2 || loading} onClick={() => void findLocations(text.trim())}>{loading ? 'Finding…' : 'Find locations'}</Button>}
    </div>
    <p id="board-location-help" className="board-filter-help">{selected ? `Selected: ${selected.label}` : text.trim() ? 'Find and select a location, or clear this field to search anywhere in the US.' : 'Leave blank to include all US locations.'}</p>
    {loading && <p role="status" className="board-filter-help">Finding US locations…</p>}
    <ErrorAlert title="Couldn't find locations" messages={errors} />
    {choices.length > 0 && !selected && <fieldset className="board-location-choices"><legend>Select a US location</legend>
      {choices.map((choice) => <label key={`${choice.kind}:${choice.providerId}`}><input type="radio" name="board-location-choice" onChange={() => { setSelected(choice); setText(choice.label); onChange(choice, false); input.current?.focus() }} />{choice.label}<span>{choice.kind}</span></label>)}
    </fieldset>}
    {searched && !loading && !errors.length && !choices.length && <p className="board-filter-help" role="status">No US locations found. Try a fuller city or state name.</p>}
  </div>
}
