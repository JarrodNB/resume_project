/** Facts the privacy policy and terms depend on. Fill in the operator and contact before a
 * public launch and have the wording reviewed (see docs/operations/privacy-and-legal-launch.md).
 * Retention periods here must match what Rails actually does (docs/architecture/privacy-and-data.md). */
export const LEGAL_EFFECTIVE_DATE = 'November 8, 2026'
export const LEGAL_OPERATOR = 'the Careergrind team'
export const PRIVACY_CONTACT_EMAIL = 'privacy@careergrind.example'

export const RETENTION = {
  resumeUploadDays: 30,
  spokenInterviewDays: 7,
  unverifiedAccountDays: 7,
  traceDays: 30,
  backupDays: 30,
  providerDays: 30,
} as const
