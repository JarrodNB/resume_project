/** Lets the user choose the length before any generation work is queued. */
import { Button } from '@/components/ui/button'

export function ResumeTargetChoice({ targetPages, onChange, twoPageEligible, starting, onStart }: {
  targetPages: 1 | 2
  onChange: (pages: 1 | 2) => void
  twoPageEligible: boolean
  starting: boolean
  onStart: () => void
}) {
  return (
    <div className="grid gap-4 rounded-lg border p-5">
      <fieldset disabled={starting} className="grid gap-3">
        <legend className="mb-3 font-medium">Resume length</legend>
        <label className="flex items-center gap-2"><input type="radio" name="target-pages" checked={targetPages === 1} onChange={() => onChange(1)} />One page</label>
        {twoPageEligible && <label className="flex items-center gap-2"><input type="radio" name="target-pages" checked={targetPages === 2} onChange={() => onChange(2)} />Two pages</label>}
      </fieldset>
      <p className="text-sm text-muted-foreground">{twoPageEligible
        ? 'Choose a target. If your relevant experience cannot support two useful pages, we’ll explain and return a shorter resume.'
        : 'Start with one page. Two pages become available when your career library has at least 700 words of descriptions and accomplishments.'}</p>
      <Button onClick={onStart} disabled={starting}>{starting ? 'Starting…' : 'Write my resume'}</Button>
    </div>
  )
}
