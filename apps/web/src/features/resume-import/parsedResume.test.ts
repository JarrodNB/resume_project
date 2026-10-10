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
    certifications: [],
    skills: [{ name: 'Ruby', category: null }],
    parsing_warnings: [],
  })
})

it('reads certifications separately from education and preserves credential details', () => {
  const parsed = parsedResumeFromTaskResult({ parsed_resume: {
    educations: [{ institution: 'University' }],
    certifications: [{ name: 'Cloud Architect', issuer: 'Cloud Co', issued_date: '2024', credential_id: 'ABC', credential_url: 'https://example.com/ABC' }],
  } })
  expect(parsed?.educations[0]?.institution).toBe('University')
  expect(parsed?.certifications[0]).toEqual({ name: 'Cloud Architect', issuer: 'Cloud Co', issued_date: '2024', expiry_date: null, credential_id: 'ABC', credential_url: 'https://example.com/ABC', description: null })
})
