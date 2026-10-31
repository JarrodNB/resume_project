/** Numbered page buttons under the results list.
 * Loaded pages are slices of 20 roles. When a continuation cursor exists, one extra
 * number lets the user request the next batch without implying a known total.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { pagerItems } from './searchFilters'

interface Props {
  page: number
  totalPages: number
  hasMore: boolean
  loading: boolean
  onPage: (page: number) => void
}

export function JobBoardPager({ page, totalPages, hasMore, loading, onPage }: Props) {
  const atEnd = page >= totalPages - 1
  return <nav aria-label="Results pages" className="board-pager">
    <Button type="button" variant="outline" disabled={page === 0} onClick={() => onPage(page - 1)}><ChevronLeft aria-hidden />Previous</Button>
    <ol>
      {pagerItems(page, totalPages + Number(hasMore)).map((item, index) => item === null
        ? <li key={`gap-${index}`} aria-hidden="true" className="board-pager-gap">…</li>
        : <li key={item}><button type="button" aria-label={`Page ${item + 1}`} disabled={loading && item >= totalPages} aria-current={item === page ? 'page' : undefined} onClick={() => onPage(item)}>{item + 1}</button></li>)}
    </ol>
    <Button type="button" variant="outline" disabled={loading || (atEnd && !hasMore)} onClick={() => onPage(page + 1)}>{loading && atEnd ? 'Loading…' : 'Next page'}<ChevronRight aria-hidden /></Button>
  </nav>
}
