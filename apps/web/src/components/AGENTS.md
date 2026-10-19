# AGENTS.md — apps/web/src/components

## Purpose

Shared UI used by more than one feature.

## Contents

- `AppLayout.tsx` — signed-in layout: fixed desktop navigation spine; sticky compact header with
  horizontally scrollable navigation below 900px, theme/account actions, location bar, and routed page
- `ThemeToggle.tsx` — light/dark switch (uses `lib/colorTheme.ts`)
- `ErrorAlert.tsx` — destructive alert listing error messages; renders nothing when empty
- `TransientAlert.tsx` — shared dismiss button and eight-second timeout; ErrorAlert opts in with a notification id.
- `ErrorAlert.test.tsx` — task-notification dismissal, timeout, and retry regression coverage.
- `CollapseToggle.tsx` — header button (chevron, `aria-expanded`) for a collapsible section
- `useOpenSection.ts` — open flag for one section id, from `lib/openSections.ts`
- `SectionCard.tsx` — quiet card for one resume section with a tone-colored icon; pass `sectionId` to
  collapse it until opened
- `sectionTones.ts` — per-section classes (quiet card/header, icon accent, ruled entry) and icon
- `dnd/` — drag-and-drop building blocks (see `dnd/AGENTS.md`)
- `ui/` — generated shadcn/ui components (generated; excluded from lint)

## Local Rules

- New page sections are collapsible and start collapsed. Give `SectionCard` a `sectionId`, or
  use `useOpenSection` with `CollapseToggle`. That id is what `lib/openSections.ts` remembers.
  Don't collapse the section the user is currently editing.
- Section colors come from the `--section-*` variables in `index.css`. Add a tone there (light
  and dark values, plus the `@theme inline` entry) before using it in `sectionTones.ts`.
- Tailwind only finds class names written out in full, so don't build them from template
  strings (`bg-section-${tone}` won't work); add them to `sectionTones.ts` instead.

- Certifications have a distinct section with name, issuer, issue/expiry dates, credential ID/URL, and description.
