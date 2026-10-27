# AGENTS.md — apps/web/src/components

## Purpose

Shared UI used by more than one feature.

## Contents

- `AppLayout.tsx` — signed-in layout: fixed desktop sidebar with the three sections and the
  account menu; a top bar with the current section's tabs and the task bell; and the routed page.
  Below 900px the sidebar becomes a sticky header and the tab row scrolls sideways. It also holds
  the focus-mode flag: while on, the sidebar and top bar give way to a slim bar with "Leave
  interview room". Only the chrome swaps; `<main>` and the routed page keep their place in the
  tree, so a live interview (and its recording) is never remounted
- `focusModeContext.ts` / `useFocusMode.ts` — let a page turn focus mode on while some condition
  is true (`useFocusMode(active)`); it turns off again when the page unmounts
- `workspaceSections.ts` — the sections (Home, Jobs, Library, Practice) and their tabs; a
  one-page section shows its name instead of tabs. A page selects
  the tab whose path is its longest prefix (`/jobs/42/resume` → Saved jobs). Find jobs is shared
  listing discovery; Saved jobs is the private list
- `AccountMenu.tsx` — account dropdown: email label, Account security link, light/dark switch
  (uses `lib/colorTheme.ts`), and Sign out
- `RedirectToPath.tsx` — route element that keeps old bookmarks working by redirecting to the new
  path, carrying route params along
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
  Don't collapse the section the user is currently editing, or a tab's main content.
- Section colors come from the `--section-*` variables in `index.css`. Add a tone there (light
  and dark values, plus the `@theme inline` entry) before using it in `sectionTones.ts`.
- Tailwind only finds class names written out in full, so don't build them from template
  strings (`bg-section-${tone}` won't work); add them to `sectionTones.ts` instead.

- Certifications have a distinct section with name, issuer, issue/expiry dates, credential ID/URL, and description.
