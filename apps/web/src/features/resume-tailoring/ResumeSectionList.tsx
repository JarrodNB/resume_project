/**
 * Lays out a resume's sections for editing, with a drag handle on every section but contact,
 * which always stays at the top. The parent owns the order; a drop only reports the new one.
 * Section fields hold their own drag area for bullets, so the two kinds of drag stay separate.
 */
import { Fragment, type ReactNode } from 'react'
import { DragDropProvider } from '@dnd-kit/react'
import { projectedMove, reorderList, sortableId } from '@/components/dnd/moveItems'
import { SortableItem } from '@/components/dnd/SortableItem'
import type { TailorSectionType } from './sectionOrder'

const SECTION_DRAG_TYPE = 'resume-section'

interface ResumeSectionListProps<Section> {
  /** Every section to show, in display order, with contact first. */
  sections: Section[]
  idOf: (section: Section) => string
  typeOf: (section: Section) => TailorSectionType
  titleOf: (section: Section) => string
  /** Receives the movable sections' ids in their new order. */
  onReorder: (movableIds: string[]) => void
  renderSection: (section: Section, dragHandle: ReactNode) => ReactNode
}

/** Renders the pinned contact section, then the sections that can be dragged. */
export function ResumeSectionList<Section>({ sections, idOf, typeOf, titleOf, onReorder, renderSection }: ResumeSectionListProps<Section>) {
  const pinned = sections.filter((section) => typeOf(section) === 'contact')
  const movable = sections.filter((section) => typeOf(section) !== 'contact')
  const movableIds = movable.map(idOf)

  return (
    <DragDropProvider onDragEnd={(event) => {
      if (event.canceled) return
      const sectionMove = projectedMove({ list: movableIds.map((id) => sortableId(SECTION_DRAG_TYPE, id)) }, event)
      if (sectionMove) onReorder(reorderList(movableIds, sectionMove.from.index, sectionMove.to.index))
    }}>
      {pinned.map((section) => <Fragment key={idOf(section)}>{renderSection(section, null)}</Fragment>)}
      {movable.map((section, index) => movable.length < 2 ? <Fragment key={idOf(section)}>{renderSection(section, null)}</Fragment> : (
        <SortableItem key={idOf(section)} id={sortableId(SECTION_DRAG_TYPE, idOf(section))} index={index} type={SECTION_DRAG_TYPE} label={`${titleOf(section)} section`}>
          {(dragHandle) => renderSection(section, dragHandle)}
        </SortableItem>
      ))}
    </DragDropProvider>
  )
}
