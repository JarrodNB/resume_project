/** The job header's "More" menu: edit the job or archive the job. */
import { MoreHorizontal, Pencil, Archive } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'

export function JobActionsMenu({ onEdit, onArchive }: { onEdit: () => void; onArchive: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" aria-label="More job actions"><MoreHorizontal aria-hidden /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuItem onSelect={onEdit}><Pencil aria-hidden /> Edit job</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onArchive}><Archive aria-hidden /> Archive job</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
