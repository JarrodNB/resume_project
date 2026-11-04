# AGENTS.md — apps/landing

## Purpose

Public marketing landing page. Explains the product and redirects to `apps/web` for sign-up/login.

## Stack

Vite + React + TypeScript (static build), same tooling as `apps/web`.

## Local Rules

- Static only: no auth, no API calls beyond an optional waitlist form.
- Keep it fast and simple.
- Follow the root documentation rules; use JSDoc for public contracts and non-obvious behavior.

## Local Design Rules

- The look comes from `DESIGN.md` (Transit Line). The page's strategy lives in
  `.impeccable/surfaces/apps-landing.md`.
- Sample people, jobs and companies live in `src/workedExample.ts` and stay labeled as made up.
- Claims must match `PRODUCT.md`. No testimonials, user numbers, prices or job outcomes.

## Contents

- `src/App.tsx` — page order, band, opening, limits and closing sections
- `src/ExamplePreview.tsx` — opening scripted proof, sharing the walkthrough’s answer state
- `src/LineStrip.tsx` — pinned line of stops that follows the scroll
- `src/RideStops.tsx` — the five worked-example stops
- `src/SearchMap.tsx` — the whole search as a map, like the app's Home
- `src/appLinks.ts` — where sign-up and sign-in links lead
- `vite.config.ts` — dev server on `0.0.0.0:5174`
- `Dockerfile.dev` — local dev image; `node_modules` lives in a container volume
- `VITE_APP_URL` — web app address for sign-up links; required for production builds
