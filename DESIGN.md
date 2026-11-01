---
name: Careergrind web workspace
description: Every application rides one line through its stages; the app is the system map.
colors:
  background: "#ffffff"
  foreground: "#111418"
  card: "#ffffff"
  primary: "#111418"
  primary-foreground: "#ffffff"
  secondary: "#f1f2f4"
  muted: "#f4f5f6"
  muted-foreground: "#5b6168"
  accent: "#eceef0"
  border: "#d9dce0"
  input: "#a9afb6"
  ring: "#111418"
  destructive: "#c8231b"
  band: "#111418"
  band-foreground: "#ffffff"
  band-muted: "#b8bdc3"
  band-rule: "#3a4048"
  rule-strong: "#111418"
  stop-off: "#b9bec4"
  stop-closed: "#9aa0a6"
  signal-action: "#ee352e"
  signal-action-text: "#c8231b"
  signal-ai: "#0039a6"
  signal-ai-text: "#0039a6"
  signal-wait: "#fccc0a"
  signal-wait-text: "#7a5c00"
  signal-done: "#00933c"
  signal-done-text: "#007a32"
  dark-background: "#15181c"
  dark-foreground: "#eef0f2"
  dark-card: "#1c2025"
  dark-primary: "#eef0f2"
  dark-primary-foreground: "#111418"
  dark-secondary: "#262b31"
  dark-muted: "#22262b"
  dark-muted-foreground: "#a3a9b0"
  dark-accent: "#2a2f35"
  dark-border: "#353b42"
  dark-input: "#5b6168"
  dark-destructive: "#ff6b63"
  dark-band: "#0a0c0e"
  dark-band-muted: "#a3a9b0"
  dark-band-rule: "#353b42"
  dark-rule-strong: "#eef0f2"
  dark-stop-off: "#5b6168"
  dark-stop-closed: "#6f757c"
  dark-signal-action: "#ff4a42"
  dark-signal-action-text: "#ff6b63"
  dark-signal-ai: "#4d82f0"
  dark-signal-ai-text: "#8fb0ff"
  dark-signal-wait: "#fccc0a"
  dark-signal-wait-text: "#fcd84a"
  dark-signal-done: "#22b45a"
  dark-signal-done-text: "#4ccf7c"
typography:
  display:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "2.5rem"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 800
    letterSpacing: "-0.01em"
  title-small:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.25
  body:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.55
  body-small:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  control:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 600
  label:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 600
  brand:
    fontFamily: "Archivo Variable, Helvetica Neue, Arial, sans-serif"
    fontSize: "19px"
    fontWeight: 800
    letterSpacing: "-0.01em"
rounded:
  badge: "3px"
  control: "4px"
  tile: "6px"
  round: "50%"
spacing:
  gutter-desktop: "48px"
  gutter-laptop: "28px"
  gutter-tablet: "24px"
  gutter-phone: "16px"
  section-gap: "28px"
  tile-gap: "12px"
  column-gap: "16px"
  band-height: "60px"
  tabs-height: "52px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-primary-large:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    height: "44px"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    padding: "0 14px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.muted}"
  button-ghost-hover:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
  badge-outline:
    textColor: "{colors.foreground}"
    typography: "{typography.label}"
    rounded: "{rounded.badge}"
    padding: "2px 8px"
    height: "20px"
  signage-band:
    backgroundColor: "{colors.band}"
    textColor: "{colors.band-foreground}"
    height: "{spacing.band-height}"
    padding: "0 48px"
  band-nav-link:
    textColor: "{colors.band-muted}"
    padding: "4px 18px 0"
  band-nav-link-active:
    textColor: "{colors.band-foreground}"
  section-tab:
    textColor: "{colors.muted-foreground}"
    typography: "{typography.control}"
    height: "{spacing.tabs-height}"
  section-tab-active:
    textColor: "{colors.foreground}"
  station-bullet:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.round}"
    size: "42px"
  job-tile:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.tile}"
    padding: "16px 16px 14px"
  view-switch-selected:
    backgroundColor: "{colors.rule-strong}"
    textColor: "{colors.background}"
    height: "34px"
    padding: "0 18px"
---

# Design System: Careergrind web workspace

## Overview

**Creative North Star: "The Transit Line"**

The app reads like a subway map. Each job you apply to rides one line through five stops: Saved, Applied, Interviewing, Offer, and a Rejected branch. Home is the system map. A black signage band runs across the top like station signs, and a few bright signal colors tell you what to do next. The rest is white paper and near-black ink.

It is light-first because people use it at a desk during the day. Dark mode keeps the same map with a deep ink ground. Density is medium: tight enough to see every job at once, with real space between sections. Type does the heavy lifting with one family, Archivo, at strong weights. Color is never decoration. If something is colored, it is telling you something.

This world replaced an older "paper and forest" look. Nothing from that look carries over: no warm paper ground, no green primary, no per-section accent colors.

**Key Characteristics:**
- White ground, ink type (#111418), cool grays for quiet text and hairlines.
- A black signage band holds navigation, with a thick white underline under the current section.
- Four signal colors, one meaning each, used the same way on every page.
- Round station bullets and thick lines that only appear where they show progress.
- Archivo for everything, from the 44px Home title down to 12px labels.
- Flat surfaces. Depth comes from ink rules and borders, not shadows.

## Colors

A black-and-white map with four transit signal colors that each mean one thing.

### Primary
- **Signage Ink** (`foreground`, `primary`, `band`, `rule-strong`): the near-black that does almost everything. Body text, primary buttons, the signage band, the 2px rule under page headings, the station line, filled stops, and job tile borders. In dark mode the band goes one step darker (`dark-band`) and `rule-strong` flips to light so the line stays visible.

### Signals
Each signal has two tokens. The plain one (for example `signal-action`) is the **fill** for bullets, dots, lines, and borders. The `-text` one is a darker (or, in dark mode, lighter) shade that passes contrast when the signal has to be words or an icon.

- **Action Red** (`signal-action` / `signal-action-text`): needs your action. This includes failures, because a failed draft or comparison is something you need to retry. Also the unread notification count and "missing" requirement badges.
- **Working Blue** (`signal-ai` / `signal-ai-text`): the AI is working on it right now. The only signal that moves (see Components).
- **Waiting Yellow** (`signal-wait` / `signal-wait-text`): waiting on someone else, like hearing back after you apply. A waiting next step uses quiet text next to its yellow dot.
- **Offer Green** (`signal-done` / `signal-done-text`): an offer or a success. The Offer station's ring, "met" requirement badges, "looks good" grades, and finished imports.

### Neutral
- **White Ground** (`background`, `card`): page and tile surfaces. Tiles are white on white and get their edge from an ink border.
- **Cool Gray Text** (`muted-foreground`): secondary text, inactive tabs, company names, notes.
- **Hairline Gray** (`border`): 1px dividers between rows, under the tab row, inside tiles.
- **Field Gray** (`input`): input borders and scrollbar thumbs.
- **Pale Grays** (`muted`, `secondary`, `accent`): hover fills and quiet panels. Never used to mean anything.
- **Band Gray** (`band-muted`, `band-rule`): inactive nav text on the band and thin lines inside it.
- **Stop Grays** (`stop-off`, `stop-closed`): stops a job hasn't reached yet, and the gray of a closed (rejected) job's line and the dashed branch.
- **Error Red** (`destructive`): form errors and delete actions. In light mode it is the same value as `signal-action-text`.

### Named Rules
**The One Meaning Rule.** Red means needs you, blue means AI working, yellow means waiting on someone else, green means offer or success. A signal color never shows up for any other reason, including decoration, links, charts, or section color.

**The No Fifth Signal Rule.** In-between states like "partial" or "could improve" use plain ink (`foreground`), not a signal. Only the four meanings above get color.

**The Fill vs. Text Rule.** Dots, lines, and borders use the plain signal token. Words and icons use the `-text` token. Never set small text in the fill color.

## Typography

**Display Font:** Archivo Variable (self-hosted via Fontsource, falling back to Helvetica Neue, Arial)
**Body Font:** Archivo Variable
**Label Font:** Archivo Variable

**Character:** One sturdy grotesque, used like transit signage: very bold for names and headings, plain for reading. Hierarchy comes from size and weight, not from mixing fonts.

### Hierarchy
- **Display** (800, 2.75rem, line-height 1, -0.025em): the Home title, "Your job search". Drops to 2.25rem under 900px.
- **Headline** (800, 2.5rem, 1.05, -0.025em): every other page title and the job workspace title. Drops to 1.75rem under 900px. Titles use balanced wrapping.
- **Title** (800, 20px, -0.01em): sub-headings on Home, such as the saved job count and the first-run heading.
- **Title Small** (700, 16px, 1.25): station names and job titles inside tiles.
- **Body** (400, 16px, 1.55): page intro text under a title, in gray, capped at 65ch.
- **Body Small** (400, 14px, 1.6): supporting text and descriptions, around 40 to 48ch.
- **Control** (600 to 700, 14 to 15px): nav links (15px, 600), tabs (14px, 600), buttons, and next-step links (14px, 700).
- **Label** (600, 12px): stage names under a job's stop line, the signal legend, badges.
- **Brand** (800, 19px, -0.01em): the product name in the band.

Counts (station bullets, job totals, unread badges) use tabular numbers so they don't jump around.

### Named Rules
**The One Family Rule.** Archivo is the only typeface. Don't bring in a second display or mono font.

**The Bold Sign Rule.** Headings are 700 or 800. Nothing between body weight and bold is used for headings in the Transit Line surfaces.

## Layout

The workspace is a column: signage band, then the section's tab row (only when the section has more than one page), then the page. Page content is capped at 1440px wide and centered. Detail pages like a single job cap at 1040px, and long reading text caps at about 72ch.

Side gutters step down with the screen: 48px on wide screens, 28px under 1200px, 24px under 900px, 16px under 600px. The band and tab row use the same gutters, so their left edges line up with the page.

Every page starts with a page heading: title on the left, actions on the right, then a 2px ink rule underneath. On Home the rule moves down to the top of the AI work strip instead.

Home's board is five equal columns (at least 210px each) with 16px between them. Each column starts with its station on the shared line, and the job tiles stack under it 12px apart. On narrow laptops the board scrolls sideways rather than squeezing. Under 640px it becomes one column: each station turns into a row (bullet on the left, name beside it), the connecting track is hidden, and the jobs stack under it like a vertical list of stops.

Under 900px the band's nav moves to its own second row that scrolls sideways, and the band stops being sticky. Under 900px all workspace buttons get a 44px minimum height for touch. Under 600px form fields use 16px text so phones don't zoom in.

## Elevation & Depth

The system is flat. Depth comes from ink: a 2px `rule-strong` line under page headings and above Home's strip, a 1.5px ink border around job tiles, and 1px hairlines between rows. The black band is the strongest "layer", and it is just a color.

### Shadow Vocabulary
- **Stop ring** (`box-shadow: 0 0 0 3px var(--card), 0 0 0 4.5px var(--rule-strong)`): draws the gap-and-ring around a job's current stop. It's a ring, not a lift.
- **Popover lift** (`box-shadow: 0 4px 16px rgb(17 20 24 / 0.12)`): only for things floating over the page, like the account error message.

### Named Rules
**The Ink Not Shadow Rule.** If something needs to stand apart, give it an ink border or rule. Don't add a drop shadow to tiles, cards, or panels that sit in the page.

## Shapes

Two kinds of shape: small square-ish corners for things you click or read, and perfect circles for anything on the line.

- **Badges** have 3px corners. **Buttons and the view switch** have 4px corners. **Job tiles** and empty slots have 6px corners (the `--radius` base, 0.375rem).
- **Bullets, stops, signal dots, and the brand mark** are full circles. Station bullets are 42px with a 6px ink ring and the count inside. The brand mark is a white ring on the band.
- **Lines** are thick only when they show progress: the 8px station track on Home and the 6px track on the first-run steps. A job's own stop line is a quiet 2px gray track with filled ink stops.
- **Dashed** means "not on the main line": the Rejected branch (4px dashed gray) and empty "No jobs" slots (1.5px dashed hairline).

## Components

### Buttons
Solid and square-shouldered, like a sign you can press.
- **Shape:** gently squared corners (4px), 1.5px border.
- **Primary:** ink fill, white text, 14px semibold, 36px tall with 14px side padding. Hover lightens the ink to 85%.
- **Large:** 44px tall, 2px border, 15px bold, 20px padding. Used for main page actions.
- **Grouping:** buttons in one row share one size. Icon buttons are square at the matching height (small 32px, default 36px, large 44px), and a field or select beside them matches that height too.
- **Outline:** white with an ink border; hover fills pale gray.
- **Ghost:** no border; hover fills pale gray. On the band, ghost buttons are white and hover with a 14% white wash.
- **Press:** buttons shrink to 97% on press using a fast ease-out (`cubic-bezier(0.23, 1, 0.32, 1)`, 160ms). Menu triggers don't shrink, so their menus stay put.
- **Focus:** an ink border plus a soft ring.

### Badges
- **Style:** 20px tall, 3px corners, 12px semibold. Status badges are outlines: the border uses the signal fill and the words use the signal `-text` color. A "partial" badge is an ink outline.

### Navigation (Signage Band)
- 60px black band, white type. Brand mark and name at left, then Home, Jobs, Library, Practice, then the notification bell (inside a thin round ring) and the account menu at right.
- Nav links are 15px semibold in gray. The current section turns white with a 4px white underline. Hover (on a real pointer) turns the text white with a gray underline.
- Under 900px the links drop to a second row that scrolls sideways. Under 600px the account email hides and only an icon shows.
- **Focus mode** (during a live interview) swaps the band for a slim 52px black bar with one "Leave interview room" link and a small brand mark.

### Section Tabs
- A 52px gray platform strip (`muted`) under the band, so the second level of navigation reads as part of the signage. It starts with the section name as a small uppercase label (hidden on phones). Tabs are 15px bold in dark gray (`tab-idle`). The current tab turns ink with a 4px ink underline. The job workspace uses the same 15px bold tabs on a 2px ink rule.

### Review Questions (Library)
- When an AI review has questions you can answer, they sit in a box with a 1.5px red signal border. Inside are a red bullet with "The review has N questions for you", the questions in full ink, and a filled "Answer review questions" button. Questions are never muted gray text.
- Library sections start collapsed, so each section header also shows a red-bullet count ("2 questions for you") whenever it holds open questions.

### Station Line (Home signature)
- Five stations across the top of the board, each a 42px ringed bullet holding its job count, with the stage name under it. An 8px ink track runs through every bullet.
- **Offer** gets a green ring. It's the end of the main line.
- **Rejected** is a branch, not the stop after Offer: the track into it is a 4px dashed gray line, its ring is gray, and it is labelled "Branch line".
- The **List** view keeps the same stations as smaller 28px bullets over a 2px ink rule, with jobs as rows underneath.

### Job Tile and Stop Line
- A white tile with a 1.5px ink border and 6px corners. Job title (16px bold), company in gray, then the job's own five-stop line, then a hairline and its next step.
- The stop line: passed stops are filled ink, the current stop is a bigger filled dot with a gap and ring around it, stops ahead are hollow gray. A rejected job's tile, border, and line all go gray.
- The same stop line appears in compact form (112px wide, with its stage name under it) in the Jobs list.

### Next-Step Signal
- A 12px signal dot plus a short bold label, like "Review resume draft". It links to the job tab that handles that step. Waiting steps use quiet gray text. A job with an offer shows a green dot and "Offer received"; a rejected job just says "Closed".
- **AI working** is the only animated element in the app's signal system (chat's waiting line is its one other form): a ring breathes out from the blue dot every 2.4s. With reduced motion turned on, the ring stops and stays as a faint still ring. Dots in the legend never animate.
- Home shows a legend of all four colors once, beside the AI work strip.

### View Switch
- Two joined buttons (Board, List) inside a 2px ink border with 4px corners. The selected one is filled ink with white text.

### Chat Desk
- Three columns on wide screens: saved chats (15rem), the conversation, and an "About this chat" notes panel (16.5rem), each divided by a 1px hairline. Under 1180px the panel drops and its text sits as a small note under the message box. Under 900px the saved chats become a row of tiles you swipe sideways.
- The conversation scrolls on its own above a message box that stays pinned; it follows new words unless the reader scrolled up. The box is a 1.5px ink-bordered, 6px-cornered field with the counter and Send inside it.
- Your messages are right-aligned tiles on `secondary` with a hairline border. Replies are plain text with a small ringed bullet beside "Careergrind"; the bullet turns blue (AI working) while a reply is being written. Until the first words arrive, the reply shows a 9rem line of three gray stops on a hairline track: a blue signal shuttles between them, pausing at each stop as it lights up, above a blue caption that changes every 3.2s ("Reading your message", "Thinking it through", …) and settles on a "still working" line. Screen readers hear only "Preparing your reply…". With reduced motion the signal stays still on the middle stop.
- Saved chats are a list of stops: a hollow bullet per chat, filled ink for the open one, with the date under the title.

### Practice Questions
- The Questions page is a bank, not a list of batches. A 1.5px ink-bordered "Get new questions" box holds the General/Technical/Knowledge view switch, a large primary button, and one line explaining the chosen type.
- Each question is a row with a progress mark: hollow gray stop (not answered), filled ink stop (no feedback yet), ringed ink stop (feedback ready), breathing blue dot (getting feedback), red dot (feedback out of date). Progress filters are 14px bold tabs on a 2px ink rule with outlined count badges.
- A set's page draws its five questions as a short stop line on a 2px hairline track; the open stop sits on a pale `muted` plate with a thick underline. The question card is a 1.5px ink-bordered tile with a 22px 800-weight question, the answer on the left and feedback on a `muted` panel on the right (a dashed outline before any feedback). Replace and "Don't show this again" sit in the card's "…" menu.

### First-Run Line
- With no jobs saved, Home shows three starting steps on a short line of their own: numbered 34px ringed bullets on a 6px ink track. It runs across on desktop and turns vertical under 900px. The stops follow real progress: done stops are filled ink with a check, the stop to do now carries the same gap-and-ring as a job's current stop, and later stops are hollow gray. When jobs exist but the library is empty, Home shows a 1.5px red-bordered note (red because the next move is the user's).

### Sign-in Pages
The sign-in, sign-up, verification and password pages split the screen. On the left is a black signage panel (band color) with the brand bullet, a white 800-weight headline, and the three steps of a search drawn as white stops on one vertical 6px line. On the right is a plain white form whose heading sits above a 2px ink rule. A success message is a white box with a green signal border. On phones the panel moves to the top and drops the line and the caption.

## Do's and Don'ts

### Do:
- **Do** use the four signals only for their one meaning: red needs you (including failures), blue AI working, yellow waiting on someone else, green offer or success.
- **Do** use the `-text` token whenever a signal colors words or icons, and the plain token for dots, lines, and borders.
- **Do** show "partial" and "could improve" in plain ink.
- **Do** draw Rejected as a dashed gray branch off the line, never as the stop after Offer.
- **Do** separate things with ink rules (2px) and hairlines (1px) instead of shadows.
- **Do** keep looping motion to AI work: the breathing blue ring, and the shuttling signal while a chat reply is being prepared. Turn both off under reduced motion.
- **Do** stack the board into a vertical list of stations on phones.
- **Do** keep Archivo at 700 to 800 for headings and use tabular numbers for counts.

### Don't:
- **Don't** use a signal color for decoration, links, charts, or to tell sections apart.
- **Don't** add a fifth status color for in-between states.
- **Don't** put small white text on a signal fill; it doesn't have enough contrast.
- **Don't** draw thick colored lines where nothing is progressing.
- **Don't** bring back the old paper-and-forest look: warm paper ground, green primary, or per-section accent colors.
- **Don't** build the gray-sidebar kanban with pastel status pills that most job trackers ship.
- **Don't** add drop shadows to tiles or panels that sit in the page.
