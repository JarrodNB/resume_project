/** Reads answered questions defensively; a broken optional diagram never hides a usable answer. */
export interface StudyDiagram {
  caption: string
  explanation: string
  nodes: { id: string; label: string }[]
  edges: { from_node: string; to_node: string; label: string }[]
}
export interface StudyQuestion {
  question: string
  why_it_matters: string
  answer: string
  example: string
  diagram?: StudyDiagram | null
}
export interface StudyGuide { version: 1; title: string; questions: StudyQuestion[] }
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9_]{0,31}$/.test(value)
const keys = (value: Record<string, unknown>, allowed: string[]) => Object.keys(value).every((key) => allowed.includes(key))

function parseDiagram(value: unknown): StudyDiagram | null {
  if (!object(value) || !keys(value, ['caption', 'explanation', 'nodes', 'edges']) || !text(value.caption, 200) || !text(value.explanation, 1000)) return null
  const { nodes, edges } = value
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes.length > 6 || !Array.isArray(edges) || edges.length < 1 || edges.length > 8) return null
  if (!nodes.every((node: unknown) => object(node) && keys(node, ['id', 'label']) && id(node.id) && text(node.label, 160))) return null
  const ids = new Set(nodes.map((node) => node.id))
  if (ids.size !== nodes.length) return null
  if (!edges.every((edge: unknown) => object(edge) && keys(edge, ['from_node', 'to_node', 'label']) && text(edge.label, 160)
    && ids.has(edge.from_node) && ids.has(edge.to_node) && edge.from_node !== edge.to_node)) return null
  if (new Set(edges.map((edge) => `${edge.from_node}:${edge.to_node}`)).size !== edges.length) return null
  if (new Set(edges.flatMap((edge) => [edge.from_node, edge.to_node])).size !== ids.size) return null
  return value as unknown as StudyDiagram
}

export function parseStudyGuide(result: unknown): StudyGuide | null {
  if (!object(result) || !object(result.study_guide)) return null
  const guide = result.study_guide
  if (guide.version !== 1 || !text(guide.title, 200) || !Array.isArray(guide.questions) || guide.questions.length !== 5) return null
  if (!guide.questions.every((question: unknown) => object(question) && text(question.question, 1000)
    && text(question.why_it_matters, 1000) && text(question.answer, 6000) && text(question.example, 3000))) return null
  return { version: 1, title: guide.title, questions: (guide.questions as StudyQuestion[]).map((question) => ({
    ...question, diagram: parseDiagram(question.diagram),
  })) }
}
