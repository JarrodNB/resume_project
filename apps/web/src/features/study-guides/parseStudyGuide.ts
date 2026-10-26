/** Reads validated learning content defensively so a malformed older result cannot crash the page. */
export interface StudyTopic {
  title: string
  why_it_matters: string
  explanation: string
  exercises: string[]
  self_check_questions: string[]
}
export interface StudyGuide { title: string; topics: StudyTopic[] }
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const list = (value: unknown): value is string[] => Array.isArray(value) && value.length > 0 && value.every(text)
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function parseStudyGuide(result: unknown): StudyGuide | null {
  if (!object(result) || !object(result.study_guide)) return null
  const guide = result.study_guide
  if (!text(guide.title) || !Array.isArray(guide.topics) || !guide.topics.length) return null
  if (!guide.topics.every((topic: unknown) => object(topic) && text(topic.title) && text(topic.why_it_matters)
    && text(topic.explanation) && list(topic.exercises) && list(topic.self_check_questions))) return null
  return guide as unknown as StudyGuide
}
