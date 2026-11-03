/**
 * Description: A role's highlights in the career library, each draggable to a new place in the
 * role or into another role (even one with no highlights yet).
 * Index:
 *   - SortableHighlightList: drop area with one draggable row per highlight
 */
import { LibraryDetail } from './LibraryDetail'
import { SortableGroup } from '@/components/dnd/SortableGroup'
import { SortableItem } from '@/components/dnd/SortableItem'
import { sortableGroupId, sortableId } from '@/components/dnd/moveItems'
import { HIGHLIGHT_TYPE } from './useLibraryDragHandlers'

interface SortableHighlightListProps {
  experienceId: string
  highlights: { id: string; content: string }[]
  movingHighlight?: boolean
}

/** Renders the highlights as draggable rows; an empty role shows a drop hint. */
export function SortableHighlightList({ experienceId, highlights, movingHighlight = false }: SortableHighlightListProps) {
  const group = sortableGroupId('highlights', experienceId)

  return (
    <SortableGroup id={group} accept={HIGHLIGHT_TYPE} className="library-highlights">
      {highlights.length === 0 && (
        <p className="library-highlight-drop">Drag a highlight here</p>
      )}
      {highlights.map((highlight, index) => (
        <SortableItem
          key={highlight.id}
          id={sortableId(HIGHLIGHT_TYPE, highlight.id)}
          index={index}
          type={HIGHLIGHT_TYPE}
          group={group}
          label={highlight.content}
          className="library-highlight"
        >
          {(dragHandle) => (
            <>
              {dragHandle}
              <div className="min-w-0 flex-1">
                <LibraryDetail kind="experience_highlight" recordId={highlight.id} text={highlight.content} disabled={movingHighlight} />
              </div>
            </>
          )}
        </SortableItem>
      ))}
    </SortableGroup>
  )
}
