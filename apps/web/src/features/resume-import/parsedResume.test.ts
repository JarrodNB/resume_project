/**
 * Description: Tests for reading a parse_resume task result into a ParsedResume.
 */
import { expect, it } from 'vitest'
import { emptyExperienceRole, parsedResumeFromTaskResult } from './parsedResume'

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
    experiences: [{ company: 'Acme', location: null, description: null, roles: [{ ...emptyExperienceRole(), title: 'Engineer' }], shared_highlights: [] }],
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

it('normalizes legacy blocks separately and preserves nested shared and role ownership', () => {
  const parsed = parsedResumeFromTaskResult({ parsed_resume: { experiences: [
    { company: 'Acme', title: 'Engineer', start_date: '2020', highlights: ['Legacy bullet'] },
    { company: 'Acme', roles: [{ title: 'Lead', highlights: ['Role bullet'] }], shared_highlights: ['Shared bullet'], source_ids: ['private'] },
  ] } })
  expect(parsed?.experiences).toEqual([
    { company: 'Acme', location: null, description: null, roles: [{ title: 'Engineer', start_date: '2020', end_date: null, is_current: false, description: null, highlights: ['Legacy bullet'] }], shared_highlights: [] },
    { company: 'Acme', location: null, description: null, roles: [{ title: 'Lead', start_date: null, end_date: null, is_current: false, description: null, highlights: ['Role bullet'] }], shared_highlights: ['Shared bullet'] },
  ])
})

it('keeps a legacy introductory description on its single role', () => {
  const parsed = parsedResumeFromTaskResult({ parsed_resume: { experiences: [
    { company: 'Acme', title: 'Engineer', description: 'Built the original platform.' },
  ] } })
  expect(parsed?.experiences[0].description).toBeNull()
  expect(parsed?.experiences[0].roles[0].description).toBe('Built the original platform.')
})
