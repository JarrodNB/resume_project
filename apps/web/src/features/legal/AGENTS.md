# AGENTS.md — features/legal

## Purpose

Public privacy policy (`/privacy`) and terms of service (`/terms`), readable signed in or out.

## Local Rules

- Keep `legalDetails.ts` retention numbers in step with Rails and with
  `docs/architecture/privacy-and-data.md`. Change both together.
- When a new third party starts receiving user data, add it to the privacy policy's processor list.
- The text is a plain-language draft, not legal advice. Material changes need a new effective
  date and notice to users (see `docs/operations/privacy-and-legal-launch.md`).
