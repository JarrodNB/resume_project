/**
 * Description: Tests for the client-side resume file checks.
 */
import { expect, it } from 'vitest'
import { MAX_RESUME_FILE_BYTES, validateResumeFile } from './resumeFileValidation'

const fileOf = (name: string, bytes: number) => new File([new Uint8Array(bytes)], name)

it('accepts PDF and DOCX files', () => {
  expect(validateResumeFile(fileOf('resume.pdf', 10))).toBeNull()
  expect(validateResumeFile(fileOf('Resume.DOCX', 10))).toBeNull()
})

it('rejects other file types, empty files, and files over 5 MB', () => {
  expect(validateResumeFile(fileOf('resume.txt', 10))).toMatch(/PDF or Word/)
  expect(validateResumeFile(fileOf('resume.pdf', 0))).toMatch(/empty/)
  expect(validateResumeFile(fileOf('resume.pdf', MAX_RESUME_FILE_BYTES + 1))).toMatch(/5 MB/)
})
