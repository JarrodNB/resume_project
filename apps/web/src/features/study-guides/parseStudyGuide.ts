/** Reads the answered-question contract defensively so malformed saved results cannot crash the reader. */
export interface StudyQuestion {
  question: string
  why_it_matters: string
  answer: string
  example: string
}
export interface StudyGuide { version: 1; title: string; questions: StudyQuestion[] }
const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= max
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

export function parseStudyGuide(result: unknown): StudyGuide | null {
  if (!object(result) || !object(result.study_guide)) return null
  const guide = result.study_guide
  if (guide.version !== 1 || !text(guide.title, 200) || !Array.isArray(guide.questions) || guide.questions.length !== 5) return null
  if (!guide.questions.every((question: unknown) => object(question) && text(question.question, 1000)
    && text(question.why_it_matters, 1000) && text(question.answer, 6000) && text(question.example, 3000))) return null
  return guide as unknown as StudyGuide
}
