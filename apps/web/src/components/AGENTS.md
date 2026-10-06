# AGENTS.md — apps/web/src/components

## Purpose

Shared UI used by more than one feature.

## Contents

- `AppLayout.tsx` — signed-in layout: header (Career library, Import resume, Jobs, Resumes,
  `ThemeToggle`, sign out) and routed page
- `ThemeToggle.tsx` — light/dark switch (uses `lib/colorTheme.ts`)
- `ErrorAlert.tsx` — destructive alert listing error messages; renders nothing when empty
- `CollapseToggle.tsx` — header button (chevron, `aria-expanded`) for a collapsible section
- `useOpenSection.ts` — open flag for one section id, from `lib/openSections.ts`
- `SectionCard.tsx` — card for one resume section, colored by its `tone`; pass `sectionId` to
  collapse it until opened
- `sectionTones.ts` — per-section classes (card stripe, header band, icon, entry tint) and icon
- `dnd/` — drag-and-drop building blocks (see `dnd/AGENTS.md`)
- `ui/` — generated shadcn/ui components (exempt from the header rule and lint)

## Local Rules

- New page sections are collapsible and start collapsed. Give `SectionCard` a `sectionId`, or
  use `useOpenSection` with `CollapseToggle`. That id is what `lib/openSections.ts` remembers.
  Don't collapse the section the user is currently editing.
- Section colors come from the `--section-*` variables in `index.css`. Add a tone there (light
  and dark values, plus the `@theme inline` entry) before using it in `sectionTones.ts`.
- Tailwind only finds class names written out in full, so don't build them from template
  strings (`bg-section-${tone}` won't work); add them to `sectionTones.ts` instead.
