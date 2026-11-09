/** Facts the privacy policy, terms and sign-up notice depend on. Production builds stop while the
 * contact email is a placeholder (see vite.config.ts). Have the wording reviewed before a public
 * launch (see docs/operations/privacy-and-legal-launch.md).
 * Retention periods here must match what Rails actually does (docs/architecture/privacy-and-data.md). */
export const LEGAL_EFFECTIVE_DATE = 'November 8, 2026'
export const MINIMUM_AGE = 18
export const PRIVACY_CONTACT_EMAIL = 'privacy@careergrind.example'

export const RETENTION = {
  resumeUploadDays: 30,
  spokenInterviewDays: 7,
  unverifiedAccountDays: 7,
  traceDays: 30,
  backupDays: 30,
  providerDays: 30,
} as const
