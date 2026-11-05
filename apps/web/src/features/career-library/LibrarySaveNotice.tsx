/**
 * Description: The "Saved" confirmation for the career library. A save dialog closes as soon as
 * it works, so this shows a short toast at the bottom of the page and scrolls the section that
 * changed into view. It never moves keyboard focus, and it jumps instead of gliding when the
 * person prefers reduced motion.
 * Index:
 *   - LibraryNotice: message plus the section anchor to scroll to
 *   - useLibraryNotice: lets a save report that it worked (does nothing outside the page)
 *   - LibrarySaveNoticeProvider: shows the toast and scrolls
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { CircleCheck } from 'lucide-react'
import { AlertDescription } from '@/components/ui/alert'
import { TransientAlert } from '@/components/TransientAlert'

export interface LibraryNotice {
  message: string
  sectionId?: string
}

const LibraryNoticeContext = createContext<(notice: LibraryNotice) => void>(() => {})

/** Returns a function that shows a save confirmation. */
export function useLibraryNotice() {
  return useContext(LibraryNoticeContext)
}

/** Scrolls an element into view only if needed, without taking focus. */
function scrollIntoViewGently(id: string) {
  const element = document.getElementById(id)
  if (!element || typeof element.scrollIntoView !== 'function') return
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' })
}

/** Provides the notice function to the page and renders the latest toast. */
export function LibrarySaveNoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<(LibraryNotice & { key: number }) | null>(null)
  const show = useCallback((next: LibraryNotice) => setNotice((current) => ({ ...next, key: (current?.key ?? 0) + 1 })), [])

  useEffect(() => {
    // Wait a frame so the refetched list has rendered before measuring.
    if (!notice?.sectionId) return
    const frame = window.requestAnimationFrame(() => scrollIntoViewGently(notice.sectionId!))
    return () => window.cancelAnimationFrame(frame)
  }, [notice])

  return (
    <LibraryNoticeContext.Provider value={show}>
      {children}
      {notice && (
        <div className="fixed bottom-4 left-1/2 z-50 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2" role="status">
          <TransientAlert key={notice.key}>
            <CircleCheck />
            <AlertDescription>{notice.message}</AlertDescription>
          </TransientAlert>
        </div>
      )}
    </LibraryNoticeContext.Provider>
  )
}
