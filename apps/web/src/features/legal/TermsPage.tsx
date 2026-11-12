/** Plain-language terms of service. Links to the privacy policy for data handling. */
import { Link } from 'react-router'
import { PRODUCT_NAME } from '@/lib/productName'
import { LegalPage } from './LegalPage'
import { MINIMUM_AGE, PRIVACY_CONTACT_EMAIL } from './legalDetails'

export function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>These terms are an agreement between you and {PRODUCT_NAME}. By creating an account you agree to them. Our <Link to="/privacy">privacy policy</Link> explains how we handle your data.</p>

      <h2>Your account</h2>
      <p>You must be at least {MINIMUM_AGE} and give a real email address. Keep your password private; you’re responsible for what happens in your account. One person per account.</p>

      <h2>Your content</h2>
      <p>You own what you upload and write. You give us permission to store and process it only to run the service for you, including sending it to the providers listed in the privacy policy. You can delete it at any time.</p>
      <p>Only upload information you have the right to share. Don’t upload other people’s personal details beyond what normally appears in a resume or job posting.</p>

      <h2>AI output</h2>
      <p>{PRODUCT_NAME} uses AI to suggest resume wording, compare your experience with jobs and run practice interviews. AI can be wrong. It is designed to use only facts from your career library, but you are responsible for checking that anything you send to an employer is true. Practice feedback is not a prediction of any hiring decision.</p>

      <h2>Fair use</h2>
      <p>Don’t misuse the service: no attempts to break security, get around usage limits, scrape it, overload it, or use it to send bulk or misleading applications. We set limits on AI usage to keep costs fair and may change them.</p>

      <h2>Job listings and links</h2>
      <p>Job listings come from third parties. We don’t guarantee they are accurate or still open, and we aren’t responsible for other sites you visit from them.</p>

      <h2>Changes and availability</h2>
      <p>We may change or stop features. The service may be unavailable at times, for example during updates. If we change these terms in a way that matters, we’ll tell you before the change takes effect.</p>

      <h2>Ending your account</h2>
      <p>You can delete your account at any time from the account page. We may suspend or close accounts that break these terms, and we’ll tell you why unless the law or safety prevents it.</p>

      <h2>No warranty and limits on liability</h2>
      <p>The service is provided “as is”, without warranties of any kind, to the extent the law allows. To the extent the law allows, we aren’t liable for indirect or consequential losses, such as a missed job opportunity, and our total liability is limited to the amount you paid us in the past 12 months.</p>

      <h2>Contact</h2>
      <p>Questions? Email <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`}>{PRIVACY_CONTACT_EMAIL}</a>.</p>
    </LegalPage>
  )
}
