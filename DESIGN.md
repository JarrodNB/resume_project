---
name: Careergrind web workspace
description: A career folio for thoughtful, focused applications.
colors:
  background: "#f6f5f0"
  foreground: "#25352e"
  card: "#ffffff"
  primary: "#285c45"
  primary-foreground: "#ffffff"
  secondary: "#e9eee7"
  secondary-foreground: "#2b513e"
  muted: "#eeeee7"
  muted-foreground: "#626b63"
  accent: "#e7ede3"
  accent-foreground: "#254d39"
  destructive: "#b43732"
  border: "#dcdfd5"
  input: "#c7cdc2"
  ring: "#427456"
  sidebar: "#eeefe8"
  sidebar-accent: "#dfe8db"
  sidebar-accent-foreground: "#254d39"
  sidebar-border: "#d9ddd1"
  section-contact-accent: "oklch(0.45 0.06 260)"
  section-summary-accent: "oklch(0.74 0.14 68)"
  section-experience-accent: "oklch(0.31 0.075 262)"
  section-projects-accent: "oklch(0.67 0.14 38)"
  section-education-accent: "oklch(0.52 0.07 248)"
  section-certifications-accent: "oklch(0.52 0.07 248)"
  section-skills-accent: "oklch(0.72 0.13 70)"
  section-facts-accent: "oklch(0.55 0.1 165)"
  dark-background: "#191f1b"
  dark-foreground: "#e7ebe2"
  dark-card: "#222a24"
  dark-primary: "#a6c6a5"
  dark-primary-foreground: "#1d3425"
  dark-secondary: "#303d31"
  dark-secondary-foreground: "#d3e2ce"
  dark-muted: "#293129"
  dark-muted-foreground: "#acb6a9"
  dark-accent: "#334332"
  dark-accent-foreground: "#e0ecda"
  dark-destructive: "#f08b80"
  dark-border: "#3b463b"
  dark-input: "#546150"
  dark-ring: "#a6c6a5"
  dark-sidebar: "#202720"
  dark-sidebar-accent: "#344332"
  dark-sidebar-accent-foreground: "#e0ecda"
  dark-sidebar-border: "#3b463b"
  dark-section-contact-accent: "oklch(0.7 0.03 250)"
  dark-section-summary-accent: "oklch(0.8 0.13 80)"
  dark-section-experience-accent: "oklch(0.72 0.1 190)"
  dark-section-projects-accent: "oklch(0.72 0.13 295)"
  dark-section-education-accent: "oklch(0.72 0.11 240)"
  dark-section-certifications-accent: "oklch(0.72 0.11 240)"
  dark-section-skills-accent: "oklch(0.74 0.12 160)"
  dark-section-facts-accent: "oklch(0.74 0.1 175)"
typography:
  headline:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.035em"
  display:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "3rem"
    fontWeight: 550
    lineHeight: 1.12
    letterSpacing: "-0.04em"
  body:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "14px"
    lineHeight: 1.7
  label:
    fontFamily: "Geist Variable, sans-serif"
    fontSize: "12px"
    fontWeight: 500
rounded:
  sm: "0.45rem"
  md: "0.6rem"
  lg: "0.75rem"
  xl: "1.05rem"
  4xl: "1.95rem"
spacing:
  control-inline: "10px"
  section: "20px"
  page-inline: "44px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "0 10px"
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
  button-ghost:
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: "32px"
  input:
    rounded: "{rounded.lg}"
    height: "32px"
    padding: "4px 10px"
  badge-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.secondary-foreground}"
    rounded: "{rounded.4xl}"
    height: "20px"
  section-card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.xl}"
---

# Design System: Careergrind web workspace

## Overview

**Creative North Star: "The Career Folio"**

The career folio presents career evidence as an ordered personal record. Warm paper, forest ink, restrained selection, and ruled rows keep long editing sessions calm and readable.

The main web app shares this system across signed-in tools and authentication. The separate marketing landing page is outside this specification.

**Key Characteristics:**

- Quiet surfaces and visible current location.
- Clear page titles and restrained action hierarchy.
- Remembered disclosures and structurally responsive navigation.

## Colors

### Primary

Forest green identifies primary actions, links, selection, and the brand mark. Its dark-mode counterpart is a pale sage with dark green text.

### Neutral

Warm paper is the page ground; white is the light-mode card surface. Forest ink carries primary text, with muted green-gray for supporting copy. Borders and navigation surfaces are slightly darker than the ground. Dark mode uses deep forest surfaces and pale text.

Section accents remain distinct on icons; section backgrounds are quiet card surfaces. The frontmatter lists only the reused section icon accents, not the legacy unused tint tokens or chart palette.

**The Quiet Record Rule.** Let evidence and headings carry the page; use borders rather than colored section bands to organize records.

## Typography

Geist Variable with a sans-serif fallback serves every role. Page headings use the headline token; auth introductions use display. Supporting page copy uses the body token with a maximum measure of 65ch. Navigation is 14px, reducing to 13px on compact layouts; group labels are 12px. Section titles are 16px at medium weight. Desktop auth headings step down to 2.5rem below 1200px and 2rem below 600px; page headings step down to 1.75rem below 900px.

## Layout

Above 899px, a fixed navigation spine is 238px wide, with a matching body offset. Its content can scroll vertically. The top bar is 76px tall. Workspace content is centered within 1440px, with 48px top, 44px horizontal, and 80px bottom padding. Standard narrow page wrappers expand to 1040px.

Below 1200px, content padding becomes 36px 28px 64px; the library's 220px guide moves below the records. Below 900px, navigation becomes a sticky compact header with a horizontally scrollable row; route changes bring the active item into view. The body offset disappears, the top bar becomes 52px, and content padding is 32px 24px 64px. Below 600px, content padding is 28px 16px 48px and heading actions occupy their own row.

Authentication uses equal columns, with a 360px-wide form. Below 600px it stacks; the workflow list and caption hide. The library uses 12px between sections and 32px between the records and guide. Record rows use 24px vertical padding, reducing to 20px on small screens.

## Elevation & Depth

Depth comes mainly from surface color, fine rules, and the generated card's subtle foreground ring. Section cards explicitly remove shadows. Focus uses a three-pixel ring at half opacity of the ring color. Overlays retain the generated UI library's own treatments; this is not a global ban on shadows.

Navigation and record hover transitions last 160ms. Disclosures rotate a chevron. Reduced-motion preference reduces transition and animation durations to 0.01ms.

## Shapes

Generated controls use the large radius; cards use the extra-large radius. Navigation has a 7px radius, record links 8px, and dashed empty-state containers 12px. Pills use the largest listed radius. Keep borders fine and forms recognizable rather than nesting colored containers.

## Components

Buttons retain generated primary, outline, secondary, ghost, destructive, and link variants. Default buttons are 32px tall; compact variants remain available. Workspace buttons below 900px and auth submit buttons have a 44px minimum height. Auth fields also have a 44px minimum height.

Inputs have a fine input-colored border, transparent light background by default, and a tinted dark background. Focus changes the border and adds a ring; invalid fields use destructive color. Auth inputs use the card background.

Secondary badges provide quiet section counts. Section cards have 20px header and content padding, a divider when open, an optional icon, and a count. A section id enables remembered disclosure; its body unmounts when closed. Add actions live inside the open content. Library entries use top rules and transparent backgrounds.

Navigation pairs simple line icons with text. The selected item uses the sidebar accent and medium-heavy text. Hover uses the muted surface. Preserve the skip link, semantic navigation, visible focus, and related-route selection.

## Do's and Don'ts

### Do:

- Do use semantic theme variables in both color modes.
- Do preserve disclosure state and keep the current navigation item visible.
- Do use quiet rules to separate career records.

### Don't:

- Don't restore colored header bands or accent stripes to section cards.
- Don't replace the mobile navigation with a clipped desktop sidebar.
- Don't treat the marketing landing page as covered by this workspace system.
