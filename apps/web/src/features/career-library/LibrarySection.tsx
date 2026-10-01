/**
 * Description: Card for one part of the career library, with a count and an empty state.
 * Index:
 *   - LibrarySection: titled card; shows `emptyText` when `count` is 0
 */
import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface LibrarySectionProps {
  title: string
  count: number
  emptyText: string
  children: ReactNode
}

/** Renders a titled, counted card around library entries. */
export function LibrarySection({ title, count, emptyText, children }: LibrarySectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <CardTitle className="text-lg">{title}</CardTitle>
        <Badge variant="secondary">{count}</Badge>
      </CardHeader>
      <CardContent>{count === 0 ? <p className="text-sm text-muted-foreground">{emptyText}</p> : children}</CardContent>
    </Card>
  )
}
