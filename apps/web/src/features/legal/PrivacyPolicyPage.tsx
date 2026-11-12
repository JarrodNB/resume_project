/** Plain-language privacy policy: what we collect, who processes it, how long we keep it, and
 * how to export or delete it. Retention numbers come from legalDetails.ts. */
import { Link } from 'react-router'
import { PRODUCT_NAME } from '@/lib/productName'
import { LegalPage } from './LegalPage'
import { MINIMUM_AGE, PRIVACY_CONTACT_EMAIL, RETENTION } from './legalDetails'

export function PrivacyPolicyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>{PRODUCT_NAME} helps you write tailored resumes and prepare for interviews. This page explains what we collect, why, who helps us process it, how long we keep it, and how you can get a copy or delete it.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your sign-in email, a hashed password (we never see the original), and your name.</li>
        <li><strong>Career information you add:</strong> resume files you upload, your career library (experience, projects, education, certifications, skills), profile and contact details, and answers you give about job requirements.</li>
        <li><strong>Job search records:</strong> jobs you save or paste in, notes, stages, tailored resumes, chat conversations and written interview practice.</li>
        <li><strong>Spoken interview practice:</strong> recordings of your answers, their transcripts, the interviewer’s audio, and feedback.</li>
        <li><strong>Technical data:</strong> a session cookie that keeps you signed in, IP addresses used for rate limiting and abuse prevention, and error and performance logs.</li>
      </ul>
      <p>We don’t sell your data, show ads, or use your data to train AI models.</p>

      <h2>How we use it</h2>
      <p>Only to run the features you ask for: parsing your resume, comparing your experience with a job, writing resume drafts, answering in chat, running interview practice, and keeping the service secure and within cost limits. Before text you write goes to an AI model, we screen it for instructions that could misuse the model.</p>

      <h2>Who processes it for us</h2>
      <ul>
        <li><strong>OpenAI</strong> runs the AI models, speech transcription, speech and embeddings. It receives the parts of your data a feature needs. Under its API terms it doesn’t train on this data and may keep it for up to {RETENTION.providerDays} days for abuse monitoring.</li>
        <li><strong>TypeSafe</strong> screens text you write before it reaches a model.</li>
        <li><strong>Pydantic Logfire</strong> stores traces of AI calls so we can debug and measure cost. Traces include prompt and response text. Your known name, email and phone are masked before traces leave our servers.</li>
        <li><strong>Amazon Web Services</strong> hosts the app, database, files and queues in the United States.</li>
        <li><strong>Cloudflare Turnstile</strong> checks that sign-ups come from a person.</li>
        <li><strong>CleanJobData</strong> provides job listings. It receives the keywords and filters you search with, but not your name or email.</li>
        <li><strong>Our email provider</strong> sends verification and password-reset emails.</li>
      </ul>

      <h2>How long we keep it</h2>
      <ul>
        <li><strong>Your saved work</strong> (career library, jobs, resumes, chats, written practice): until you delete it or delete your account.</li>
        <li><strong>Uploaded resume files:</strong> deleted {RETENTION.resumeUploadDays} days after we finish reading them. What we extracted stays in your career library.</li>
        <li><strong>Spoken interviews:</strong> questions, transcripts, recordings and feedback are deleted {RETENTION.spokenInterviewDays} days after the interview starts. Interviewer audio is deleted sooner, about an hour after the interview ends.</li>
        <li><strong>Accounts that are never verified:</strong> deleted after {RETENTION.unverifiedAccountDays} days.</li>
        <li><strong>AI traces:</strong> deleted after {RETENTION.traceDays} days.</li>
        <li><strong>Database backups:</strong> kept for up to {RETENTION.backupDays} days, then overwritten.</li>
      </ul>

      <h2>Your choices</h2>
      <ul>
        <li><strong>Download your data:</strong> on the <Link to="/account/security">account page</Link>, choose “Download my data” for a JSON copy of everything you saved.</li>
        <li><strong>Delete your account:</strong> on the same page, choose “Delete account” and confirm your password. Your account and saved work are removed right away, uploaded files and recordings within minutes, and remaining copies in backups and traces within {Math.max(RETENTION.backupDays, RETENTION.traceDays)} days.</li>
        <li><strong>Edit or delete individual items</strong> at any time in the app.</li>
      </ul>
      <p>Depending on where you live, you may have other rights, such as asking what we hold about you or objecting to how we use it. Email <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a> and we’ll respond within 30 days.</p>

      <h2>Security</h2>
      <p>Traffic is encrypted with HTTPS. Passwords are hashed. The AI service can only read the records it needs, through a read-only database role. No system is perfectly secure, so please use a unique password.</p>

      <h2>Children</h2>
      <p>{PRODUCT_NAME} is for people {MINIMUM_AGE} and older. We don’t knowingly collect data from anyone younger. If you believe someone under {MINIMUM_AGE} has an account, email <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a> and we’ll delete it.</p>

      <h2>Changes</h2>
      <p>If we change this policy in a way that matters, we’ll update the date above and tell you in the app or by email before the change takes effect.</p>
    </LegalPage>
  )
}
