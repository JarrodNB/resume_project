/** Draws bounded answer relationships with application-owned shapes and arrows.
 * Labels remain ordinary escaped text; the prose equivalent carries the same meaning without sight.
 */
import { useId } from 'react'
import { ArrowDown, ArrowRight } from 'lucide-react'
import type { StudyDiagram } from './parseStudyGuide'

export function StudyAnswerDiagram({ diagram }: { diagram: StudyDiagram }) {
  const captionId = useId()
  const labels = new Map(diagram.nodes.map((node) => [node.id, node.label]))
  return <figure aria-labelledby={captionId} className="grid min-w-0 gap-4 border-t pt-5">
    <figcaption id={captionId} className="font-semibold">{diagram.caption}</figcaption>
    <div aria-hidden="true" className="grid min-w-0 gap-4">
      {diagram.edges.map((edge) => <div key={`${edge.from_node}:${edge.to_node}`} className="grid min-w-0 grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(5rem,0.7fr)_minmax(0,1fr)]">
        <div className="min-w-0 border-[1.5px] border-foreground bg-muted px-3 py-3 text-center text-sm font-medium [overflow-wrap:anywhere]">{labels.get(edge.from_node)}</div>
        <div className="grid min-w-0 justify-items-center gap-1 py-1 text-center text-sm [overflow-wrap:anywhere]">
          <span>{edge.label}</span>
          <ArrowRight className="hidden size-5 sm:block" />
          <ArrowDown className="size-5 sm:hidden" />
        </div>
        <div className="min-w-0 border-[1.5px] border-foreground bg-muted px-3 py-3 text-center text-sm font-medium [overflow-wrap:anywhere]">{labels.get(edge.to_node)}</div>
      </div>)}
    </div>
    <p className="text-sm leading-relaxed">{diagram.explanation}</p>
  </figure>
}
