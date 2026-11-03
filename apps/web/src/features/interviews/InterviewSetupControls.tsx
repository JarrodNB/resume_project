/** The labelled rows and joined switch buttons shared by both steps of interview setup. */
import { useId, type CSSProperties, type ReactNode } from 'react'

/** One labelled row of the setup panel. The label column names the radio group for screen readers. */
export function SetupRow({ title, children, group = true }: { title: ReactNode; children: ReactNode; group?: boolean }) {
  const id = useId()
  return <div className="interview-setup-row" role={group ? 'radiogroup' : undefined} aria-labelledby={group ? id : undefined}>
    <span id={id} className="interview-setup-label">{title}</span><div className="min-w-0">{children}</div>
  </div>
}

/** One pick from a short list, drawn as joined switch buttons over a native radio group. */
export function Switch({ name, options, value, change, columns = options.length === 3 ? 3 : 2 }: { name: string; options: { value: string; label: string }[]; value: string; change: (value: string) => void; columns?: number }) {
  return <div className="interview-setup-switch" style={{ '--switch-columns': columns } as CSSProperties}>
    {options.map((option) => <label key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value} onChange={() => change(option.value)} />{option.label}
    </label>)}
  </div>
}
