/** Reserves space for saved content while its first request is pending.
 * Shapes stay neutral and still so they do not imply AI activity or real records.
 * Each group announces one loading message; decorative blocks are hidden from readers.
 */
import type { ReactNode } from 'react'

type Layout = 'list' | 'sections' | 'detail' | 'board' | 'conversation'

export function ContentSkeleton({ label, layout = 'list' }: { label: string; layout?: Layout }) {
  let content: ReactNode
  switch (layout) {
    case 'board':
      content = <div className="skeleton-board">{Array.from({ length: 5 }, (_, index) => <div className="skeleton-column" key={index}>
        <Block className="skeleton-stop" /><Block className="skeleton-title" />
        <div className="skeleton-tile"><Lines /><Block className="skeleton-track" /><Block className="skeleton-short" /></div>
      </div>)}</div>
      break
    case 'sections':
      content = <div className="skeleton-sections">{Array.from({ length: 8 }, (_, index) => <div className="skeleton-section" key={index}>
        <Block className="skeleton-icon" /><Block className="skeleton-title" /><Block className="skeleton-action" />
      </div>)}</div>
      break
    case 'detail':
      content = <div className="skeleton-detail"><Lines /><div className="skeleton-tabs">{[0, 1, 2, 3].map((index) => <Block className="skeleton-short" key={index} />)}</div>
        <div className="skeleton-body"><Lines /><Lines /><Lines /></div>
      </div>
      break
    case 'conversation':
      content = <div className="skeleton-conversation">{[0, 1, 2].map((index) => <div className="skeleton-message" key={index}><Lines /></div>)}</div>
      break
    default:
      content = <div>{[0, 1, 2].map((index) => <div className="skeleton-row" key={index}><Lines /></div>)}</div>
  }
  return <div role="status" aria-busy="true" className="content-skeleton">
    <span className="sr-only">{label}</span>
    <div aria-hidden="true">{content}</div>
  </div>
}

function Block({ className }: { className: string }) {
  return <div className={`skeleton-block ${className}`} />
}

function Lines() {
  return <div className="skeleton-lines"><Block className="skeleton-title" /><Block className="skeleton-subtitle" /></div>
}
