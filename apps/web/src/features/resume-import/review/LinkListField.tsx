/**
 * Description: Editable contact links with separate visible labels and destination URLs.
 * Index:
 *   - LinkListField: add, edit, and remove structured resume links
 */
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_LINKS } from '@/lib/textLimits'
import type { ParsedLink } from '../parsedResume'

interface LinkListFieldProps {
  links: ParsedLink[]
  onChange: (links: ParsedLink[]) => void
  maxLength?: number
}

/** Lets the user edit the text and destination of each contact link. */
export function LinkListField({ links, onChange, maxLength }: LinkListFieldProps) {
  const replaceAt = (index: number, field: keyof ParsedLink, value: string) =>
    onChange(links.map((link, position) => (position === index ? { ...link, [field]: value } : link)))
  const removeAt = (index: number) => onChange(links.filter((_, position) => position !== index))

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-2 text-sm font-medium">Links</legend>
      {links.map((link, index) => (
        <div key={index} className="grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <Input
            aria-label={'Link ' + (index + 1) + ' label'}
            placeholder="LinkedIn"
            maxLength={maxLength}
            value={link.label}
            onChange={(event) => replaceAt(index, 'label', event.target.value)}
          />
          <Input
            aria-label={'Link ' + (index + 1) + ' URL'}
            type="url"
            placeholder="https://..."
            maxLength={maxLength}
            value={link.url}
            onChange={(event) => replaceAt(index, 'url', event.target.value)}
          />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={'Remove link ' + (index + 1)} onClick={() => removeAt(index)}>
            <X />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="justify-self-start" disabled={links.length >= MAX_LINKS} onClick={() => onChange([...links, { label: '', url: '' }])}>
        <Plus /> Add link
      </Button>
    </fieldset>
  )
}