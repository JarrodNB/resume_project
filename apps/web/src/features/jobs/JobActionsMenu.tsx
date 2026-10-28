/** The job header's "More" menu: edit the job, open the saved posting website, or archive the job. */
import { ExternalLink, MoreHorizontal, Pencil, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export function JobActionsMenu({ url, onEdit, onArchive }: { url: string | null; onEdit: () => void; onArchive: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More job actions"><MoreHorizontal aria-hidden /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden /> Edit job</DropdownMenuItem>
        {url && (
          <DropdownMenuItem asChild>
            <a href={url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden /> Visit website</a>
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onArchive}><Archive aria-hidden /> Archive job</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
