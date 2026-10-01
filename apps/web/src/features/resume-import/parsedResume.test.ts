/**
 * Description: Tests for reading a parse_resume task result into a ParsedResume.
 */
import { expect, it } from 'vitest'
import { emptyExperience, parsedResumeFromTaskResult } from './parsedResume'

it('returns null when the result has no parsed_resume', () => {
  expect(parsedResumeFromTaskResult(null)).toBeNull()
  expect(parsedResumeFromTaskResult({ something: 'else' })).toBeNull()
})

it('fills in missing fields with empty defaults', () => {
  const parsed = parsedResumeFromTaskResult({
    parsed_resume: { experiences: [{ company: 'Acme', title: 'Engineer' }], skills: [{ name: 'Ruby' }] },
  })

  expect(parsed).toEqual({
    contact: { full_name: null, email: null, phone: null, location: null, links: [] },
    summary: null,
    experiences: [{ ...emptyExperience(), company: 'Acme', title: 'Engineer' }],
    projects: [],
    educations: [],
    skills: [{ name: 'Ruby', category: null }],
    parsing_warnings: [],
  })
})
