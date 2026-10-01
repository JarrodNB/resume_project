/**
 * Description: Quick client-side checks on a resume file before uploading. The API re-checks the
 * real file type from its bytes, so this only saves a round trip for obvious mistakes.
 * Index:
 *   - MAX_RESUME_FILE_BYTES: 5 MB upload limit (matches the API)
 *   - ACCEPTED_RESUME_FILE_TYPES: `accept` value for file inputs
 *   - validateResumeFile: returns an error message, or null when the file looks fine
 */

export const MAX_RESUME_FILE_BYTES = 5 * 1024 * 1024

export const ACCEPTED_RESUME_FILE_TYPES =
  '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

/** Returns why `file` can't be uploaded (wrong extension, empty, or over 5 MB), or null. */
export function validateResumeFile(file: File): string | null {
  if (!/\.(pdf|docx)$/i.test(file.name)) return 'Please choose a PDF or Word (.docx) file.'
  if (file.size === 0) return 'That file is empty.'
  if (file.size > MAX_RESUME_FILE_BYTES) return 'That file is larger than 5 MB.'
  return null
}
