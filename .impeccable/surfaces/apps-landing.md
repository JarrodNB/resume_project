---
version: 1
slug: "apps-landing"
primary_target: "apps/landing"
related_targets: []
---

# Surface brief: Careergrind landing page

Scope: the public page in apps/landing. Mode: Persuade.

Audience and job: job seekers partway through a search, tired of sending the same resume everywhere. They should believe the resume stays true to their record and that they stay in charge, then sign up in apps/web. A short quiet section near the end shows how the AI is kept honest, which also serves portfolio readers.

Proof: one worked example with a made-up person and job, labeled as made up. No customers, testimonials, outcome numbers, or prices exist; none may be implied.

Constraints: static only, no API calls. Inherits the Transit Line world in DESIGN.md with bigger headlines and normal reading text. Signal colors keep their one meaning.

Chosen direction: The Door Strip. Memorable moment: a compact scripted example immediately after the opening lets visitors supply Maya’s answer and see the supported resume line beside it. The same answer updates the full walkthrough and clears the red stop.

Unresolved: production app URL (VITE_APP_URL at build time); public-launch name availability.

## Direction contract

THESIS: The page is one ride. A line diagram like the one above a subway car's doors stays pinned, and the visitor rides one job from their history to the interview. Refuses the split hero over a row of feature cards.

OWN-WORLD: White ground, ink #111418, black signage band and full-bleed ink sections, Archivo Variable at expanded width and 800 to 900 weight, ringed round stops on an 8px ink line, 2px ink rules, 1.5px ink tiles, dashed for what is not on the line. Red needs you, blue AI working, yellow waiting, green success, and nothing else is colored.

STORY: The visitor learns the promise, tries a compact answer-to-draft example without signing up, then rides five stops with Maya (library, job, gaps, resume, interview), sees that a claim with no evidence stays off the resume until the person answers, sees the whole search as a map, reads what the product refuses to do, then signs up.

FIRST VIEWPORT: 60px black band with brand at left, How it works, Sign in and a white Sign up button at right. Directly under it, the full-width strip of five stops on an 8px line, first stop ringed. The headline reads "Your experience. A resume for the job you want." A short explanation leads to Sign up and start plus Try the example. The compact, explicitly scripted example follows immediately, with question and draft side by side on desktop and stacked on phones. No account or live AI call is needed to try it.

FORM: The Door Strip, position 5 on the grounded list, dealt lead. seed:88e69ed0e1562c0a

SIGNATURE INTERACTION: The strip stays pinned and its ink line fills continuously with scroll, each stop filling as it is passed. Pressing "Try Maya’s answer" in the opening example or "Answer as Maya" in the gaps section updates both examples, clears the red stop, and fills the resume line further down. Either undo button reverses all three. Toggle buttons stay mounted to preserve keyboard focus; a live status announces the change.

MOTION GRAMMAR: Motion follows the visitor's own scroll or press. The only loop is the breathing blue AI-working ring on the map.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance


## Conversion and reading flow

Keep all five stops, with shorter explanations and section gaps of 64–104px. The closing section follows the honest limitations with the value of reusable experience, a resume the user controls, and interview practice. Marketing and metadata make no customer, price, or hiring-outcome claims.
