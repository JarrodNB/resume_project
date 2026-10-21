/** Delivery policy preserves dialogue while keeping browser utterances short. */
import { expect, it } from 'vitest'
import { interviewSpeechChunks, selectInterviewVoice } from './browserSpeechDelivery'

it('keeps words, punctuation and Unicode while splitting long clauses and unbroken words', () => {
  const text = `“Describe your project.” ${'experience, '.repeat(50)} ${'😀'.repeat(200)} Finally?`
  const chunks = interviewSpeechChunks(text)
  expect(chunks.every((chunk) => Array.from(chunk).length <= 180)).toBe(true)
  expect(chunks.join('').replace(/\s/g, '')).toBe(text.replace(/\s/g, ''))
  expect(chunks.join('')).not.toContain('\uFFFD')
})
it('uses another English voice before a non-English device default', () => {
  const english = { name: 'English device voice', lang: 'en-GB', default: false } as SpeechSynthesisVoice
  expect(selectInterviewVoice([{ name: 'French', lang: 'fr-FR', default: true } as SpeechSynthesisVoice, english])).toBe(english)
  expect(selectInterviewVoice([])).toBeNull()
})
it('keeps decimal and version punctuation within a sentence', () => {
  expect(interviewSpeechChunks('Use version 3.12. Explain why.')).toEqual(['Use version 3.12.', 'Explain why.'])
})
it('prefers Google UK English Female regardless of browser voice order', () => {
  const us = { name: 'Google US English', lang: 'en-US', default: true } as SpeechSynthesisVoice
  const genericBritish = { name: 'British device voice', lang: 'en-GB' } as SpeechSynthesisVoice
  const googleBritish = { name: 'google uk english female', lang: 'en-GB' } as SpeechSynthesisVoice
  expect(selectInterviewVoice([us, genericBritish, googleBritish])).toBe(googleBritish)
  expect(selectInterviewVoice([googleBritish, genericBritish, us])).toBe(googleBritish)
})
it('uses another British voice before a named US voice, including underscore locales', () => {
  const us = { name: 'Google US English', lang: 'en-US' } as SpeechSynthesisVoice
  const british = { name: 'British device voice', lang: 'en_GB' } as SpeechSynthesisVoice
  expect(selectInterviewVoice([us, british])).toBe(british)
  expect(selectInterviewVoice([us])).toBe(us)
  expect(selectInterviewVoice([{ name: 'French', lang: 'fr-FR' } as SpeechSynthesisVoice])).toBeNull()
})
