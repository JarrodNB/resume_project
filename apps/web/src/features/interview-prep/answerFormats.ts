/** Each answer format owns its own draft. Projection supplies existing answer consumers. */
export const answerFormats = {
  plain_text: { label: 'Plain text', explanation: 'Write a free-form answer in your own words.', fields: { text: 'Your answer' } },
  car: { label: 'CAR', explanation: 'Context, Action, Result: describe the background, what you did, and what happened.', fields: { context: 'Context', action: 'Action', result: 'Result' } },
  carl: { label: 'CARL', explanation: 'Context, Action, Result, Learning: add what you learned from the experience.', fields: { context: 'Context', action: 'Action', result: 'Result', learning: 'Learning' } },
  star: { label: 'STAR', explanation: 'Situation, Task, Action, Result: explain the situation, your responsibility, what you did, and the outcome.', fields: { situation: 'Situation', task: 'Task', action: 'Action', result: 'Result' } },
} as const
export const answerFieldHelp: Record<string, string> = {
  context: 'What was happening, and why did it matter?',
  situation: 'Describe the setting and relevant background.',
  task: 'What were you responsible for achieving?',
  action: 'Explain the steps you personally took.',
  result: 'What happened? Include evidence or outcomes you know.',
  learning: 'What did you learn, and how would you apply it?',
}
export type AnswerFormat = keyof typeof answerFormats
export type AnswerDrafts = Record<AnswerFormat, Record<string, string>>
export function normalizeAnswerFormat(format: unknown): AnswerFormat {
  return typeof format === 'string' && Object.hasOwn(answerFormats, format) ? format as AnswerFormat : 'plain_text'
}
export function normalizeAnswerDrafts(value: unknown, legacyText = ''): AnswerDrafts {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return Object.fromEntries(Object.entries(answerFormats).map(([format, definition]) => {
    const draft = source[format] && typeof source[format] === 'object' ? source[format] as Record<string, unknown> : {}
    return [format, Object.fromEntries(Object.keys(definition.fields).map((field) => [field, typeof draft[field] === 'string' ? draft[field] : format === 'plain_text' ? legacyText : '']))]
  })) as AnswerDrafts
}
export function projectAnswer(format: AnswerFormat, drafts: AnswerDrafts): string {
  if (format === 'plain_text') return drafts.plain_text.text
  return Object.entries(answerFormats[format].fields).filter(([field]) => drafts[format][field].trim()).map(([field, label]) => `${label}: ${drafts[format][field]}`).join('\n\n')
}
