/** The line of five stops that stays pinned while a visitor scrolls the landing page.
 * It is real navigation: each stop links to its section. Its ink line follows the scroll, so the
 * visitor always sees how far along the ride they are. Reads scroll position only; it changes
 * nothing else on the page.
 */
import { useEffect, useRef, useState } from 'react'
import { LINE_STOPS } from './workedExample'

/** How far down the screen a section has to reach before its stop counts as the current one. */
const ARRIVAL_POINT_OF_VIEWPORT = 0.4

/** Where the ride is: 0 at the first stop, 4 at the last, with fractions in between, and 5 once
 * the visitor has moved past the last stop's section. */
function readRidePosition(): number {
  const arrivalLine = window.innerHeight * ARRIVAL_POINT_OF_VIEWPORT
  const sectionAfterRide = document.getElementById('map')
  if (sectionAfterRide && sectionAfterRide.getBoundingClientRect().top <= arrivalLine) return LINE_STOPS.length
  const sectionTops = LINE_STOPS.map(
    (stop) => document.getElementById(stop.id)?.getBoundingClientRect().top ?? 0,
  )
  let position = 0
  for (let index = 0; index < sectionTops.length - 1; index += 1) {
    const span = sectionTops[index + 1] - sectionTops[index]
    const travelled = (arrivalLine - sectionTops[index]) / span
    position = index + Math.min(Math.max(travelled, 0), 1)
    if (travelled < 1) break
  }
  return position
}

interface LineStripProps {
  /** True while the example's open gap still needs an answer, which marks that stop red. */
  gapNeedsAnswer: boolean
}

export function LineStrip({ gapNeedsAnswer }: LineStripProps) {
  const [currentStopIndex, setCurrentStopIndex] = useState(0)
  const inkLineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let frameRequest = 0
    const updateFromScroll = () => {
      frameRequest = 0
      const position = readRidePosition()
      inkLineRef.current?.style.setProperty('transform', `scaleX(${Math.min(position / (LINE_STOPS.length - 1), 1)})`)
      setCurrentStopIndex(Math.floor(position + 0.001))
    }
    const scheduleUpdate = () => {
      if (!frameRequest) frameRequest = requestAnimationFrame(updateFromScroll)
    }
    updateFromScroll()
    window.addEventListener('scroll', scheduleUpdate, { passive: true })
    window.addEventListener('resize', scheduleUpdate)
    return () => {
      cancelAnimationFrame(frameRequest)
      window.removeEventListener('scroll', scheduleUpdate)
      window.removeEventListener('resize', scheduleUpdate)
    }
  }, [])

  return (
    <nav className="line-strip" aria-label="Stops on the way to a tailored resume">
      <div className="line-strip-track" aria-hidden>
        <div className="line-strip-ink" ref={inkLineRef} />
      </div>
      <ol className="line-strip-stops">
        {LINE_STOPS.map((stop, index) => {
          const state = index < currentStopIndex ? 'passed' : index === currentStopIndex ? 'current' : 'ahead'
          const needsYou = stop.id === 'gaps' && gapNeedsAnswer
          return (
            <li key={stop.id}>
              <a
                href={`#${stop.id}`}
                className="line-stop"
                data-state={state}
                data-needs-you={needsYou || undefined}
                aria-current={state === 'current' ? 'step' : undefined}
              >
                <span className="line-stop-bullet" aria-hidden />
                <span>{stop.label}</span>
                {needsYou && <span className="sr-only"> (one question needs an answer)</span>}
              </a>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
