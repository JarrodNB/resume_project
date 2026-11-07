/**
 * Description: The tabs that stay in view as the career library scrolls. Each one jumps to a
 * section, in the same order as the page, and the section being read is marked as current.
 * Dragging a tab moves its section, which sets the default section order for new resumes. The tabs
 * carry the drag because they stay small; a whole section can be taller than the screen.
 * A link at the end counts every review question waiting on the user and jumps to the first.
 * Index:
 *   - LibraryTabs: the sticky row of section links
 */
import { useEffect, useRef, useState } from 'react'
import { KeyboardSensor, PointerSensor } from '@dnd-kit/react'
import { useSortable } from '@dnd-kit/react/sortable'
import { sortableId } from '@/components/dnd/moveItems'
import { DragHandle } from '@/components/dnd/DragHandle'
import { SECTION_TITLES, type MovableSectionType } from '@/features/resume-tailoring/sectionOrder'
import type { CareerLibraryQuery } from '@/graphql/generated/graphql'
import { cn } from '@/lib/utils'
import { LIBRARY_SECTION_ANCHORS } from './librarySectionLinks'
import { LIBRARY_SECTION_TYPE } from './useLibraryDragHandlers'
import { useLibraryWorkspace } from './LibraryWorkspaceContext'
import { hasOpenQuestion, targetElementId, type ReviewSection } from './libraryReviewTargets'

// The whole tab accepts pointer drags; the grip remains the keyboard drag control.
const tabSensors = [PointerSensor.configure({
  activatorElements: (source) => [source.element],
  preventActivation: () => false,
}), KeyboardSensor]

function SortableLibraryTab({ section, index, count, current }: {
  section: MovableSectionType; index: number; count: number; current: string
}) {
  const { ref, handleRef, isDragging } = useSortable({
    id: sortableId(LIBRARY_SECTION_TYPE, section), index,
    type: LIBRARY_SECTION_TYPE, accept: LIBRARY_SECTION_TYPE, sensors: tabSensors,
  })
  const anchor = LIBRARY_SECTION_ANCHORS[section]
  return <div ref={ref} className={cn('library-tab transition-opacity', isDragging && 'opacity-60')} data-dragging={isDragging || undefined}>
    <DragHandle handleRef={handleRef} label={`${SECTION_TITLES[section]} section`} />
    <a href={`#${anchor}`} draggable={false} aria-current={anchor === current ? 'location' : undefined}
      className={cn('section-tab cursor-grab touch-none select-none active:cursor-grabbing', anchor === current && 'is-active')}>
      {SECTION_TITLES[section]}{count > 0 && <span className="library-tab-count">{count}</span>}
    </a>
  </div>
}

/** How many records a movable section holds. The summary is one piece of text, so it has no count. */
function sectionCount(library: CareerLibraryQuery, section: MovableSectionType) {
  switch (section) {
    case 'summary': return 0
    case 'experience': return library.experiences.length
    case 'projects': return library.projects.length
    case 'education': return library.educations.length
    case 'certifications': return library.certifications.length
    case 'skills': return library.skills.length
  }
}

/** Remembers which section sits at the top of the page, under the band and these tabs. */
function useSectionInView(anchors: string[]) {
  const [current, setCurrent] = useState(anchors[0])
  const anchorList = anchors.join(' ')
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return
    const ids = anchorList.split(' ')
    const inView = new Set<string>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target.id)
        else inView.delete(entry.target.id)
      }
      const first = ids.find((id) => inView.has(id))
      if (first) setCurrent(first)
    }, { rootMargin: '-130px 0px -65% 0px' })
    for (const id of ids) {
      const section = document.getElementById(id)
      if (section) observer.observe(section)
    }
    return () => observer.disconnect()
  }, [anchorList])
  return current
}

export function LibraryTabs({ library, order }: { library: CareerLibraryQuery; order: readonly MovableSectionType[] }) {
  const workspace = useLibraryWorkspace()
  const tabsRef = useRef<HTMLElement>(null)
  const current = useSectionInView([...order.map((section) => LIBRARY_SECTION_ANCHORS[section]), LIBRARY_SECTION_ANCHORS.career_contexts])

  // Keep the current tab in view when the row overflows on small screens.
  useEffect(() => {
    const tabs = tabsRef.current
    const activeTab = tabs?.querySelector<HTMLElement>('[aria-current]')
    if (tabs && activeTab && tabs.scrollWidth > tabs.clientWidth) {
      tabs.scrollLeft += activeTab.getBoundingClientRect().left - tabs.getBoundingClientRect().left - (tabs.clientWidth - activeTab.clientWidth) / 2
    }
  }, [current])

  const reviewedInPageOrder = [...order, 'career_contexts' as const].filter((section): section is ReviewSection => section in workspace.reviews)
  const waiting = reviewedInPageOrder.flatMap((section) => workspace.targets.filter((target) => target.section === section && workspace.reviews[section].assessments.some((item) => item.kind === target.kind && item.recordId === target.recordId && hasOpenQuestion(item))))

  function tab(anchor: string, title: string, count: number) {
    return <a href={`#${anchor}`} aria-current={anchor === current ? 'location' : undefined} className={cn('section-tab', anchor === current && 'is-active')}>
      {title}{count > 0 && <span className="library-tab-count">{count}</span>}
    </a>
  }

  return (
    <nav ref={tabsRef} className="section-tabs library-tabs" aria-label="Library sections">
      {order.map((section, index) => (
        <SortableLibraryTab key={section} section={section} index={index} count={sectionCount(library, section)} current={current} />
      ))}
      <span className="library-tab-rule" aria-hidden />
      {tab(LIBRARY_SECTION_ANCHORS.career_contexts, 'Career context', library.careerContexts.length)}
      {waiting.length > 0 && <a className="library-tab-questions review-questions-badge" href={`#${targetElementId(waiting[0])}`}><span className="signal-dot is-action" aria-hidden />{waiting.length === 1 ? '1 question for you' : `${waiting.length} questions for you`}</a>}
    </nav>
  )
}
