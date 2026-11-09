# Privacy and legal launch checklist

Steps to finish before real users sign up. The code side (retention jobs, account deletion,
data export and the policy pages) is described in
[Privacy, retention and account data](../architecture/privacy-and-data.md). This list covers
what the repository cannot do on its own.

## Before launch

1. **Fill in the legal details.** In `apps/web/src/features/legal/legalDetails.ts`, replace
   the placeholder `privacy@careergrind.example` address with a real, monitored Careergrind
   inbox. Production builds of the web app stop until you do. Set the effective date to the
   launch day.
2. **Get the wording reviewed.** The privacy policy and terms are plain-language drafts, not
   legal advice. Have someone qualified check them for the places you'll accept users from
   (for example GDPR/UK GDPR if you accept EU/UK users, CCPA/CPRA for California). Decisions
   baked into the draft to confirm: minimum age 18, US hosting, a 30-day response time for
   privacy requests, and the liability cap.
3. **Match the outside retention settings to the policy.**
   - Logfire: set the project's data retention to 30 days.
   - RDS: set automated backup retention to 30 days or less. Manual snapshots need their own
     cleanup or a note in the policy.
   - S3: don't enable object versioning on the uploads bucket, or add a lifecycle rule that
     expires noncurrent versions, so purged uploads and audio are really gone.
   - Server and container logs: keep them for 30 days or less. Rails filters passwords, but
     logs can still contain IP addresses.
4. **Review provider terms.** Accept OpenAI's data processing addendum and confirm the API
   organization isn't opted into data sharing. Do the same for TypeSafe, Logfire, your email
   provider and AWS where they offer one.
5. **Name the email provider** in the privacy policy once it's chosen.
6. **Cookie notice.** The app sets only a strictly necessary session cookie (plus
   Turnstile at sign-up), so no consent banner is needed today. Adding analytics or other
   non-essential cookies changes that.
7. **Test the flows on the release build.** Download an export from a test account and check
   it opens. Delete that account and confirm sign-in fails, its interview audio leaves S3
   within a few minutes, and its uploads are purged.

## Handling a privacy request by email

Most requests are self-service from the account page (download or delete). For anything
else, such as a request from someone who can't sign in, confirm the requester controls the
account's email address before acting. Use `Accounts::ExportAccountDataService` or
`Accounts::DeleteAccountService` logic from a Rails console rather than ad hoc SQL, and
reply within 30 days.

## When something changes

A new kind of user data, a new outside service, or a new retention period needs: the code
change, an update to the architecture page above, an update to `legalDetails.ts` and the
policy text, and a new effective date. For material changes, tell users before they apply.
