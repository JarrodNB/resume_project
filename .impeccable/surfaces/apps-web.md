---
version: 1
slug: "apps-web"
primary_target: "apps/web"
related_targets: []
---

# Surface brief: Careergrind web app (signed-in workspace)

Scope: every signed-in page in apps/web (Home, Jobs and the job workspace, Library, Practice, account). Mode: Operate. Auth pages follow after the workspace.

Audience and job: job seekers at a laptop during daytime focus sessions. They need to see where each application stands, act on what needs them, review AI drafts, and practise interviews. Must not feel corporate (LinkedIn/HR-software blue-gray) or sparse and sterile. Nothing from the old paper-and-forest look is kept.

Constraints: light-first (daytime desk); dark theme still supported. Standard web controls only. AI work states (running, ready, failed, waiting) must be recognizable everywhere. Grounded claims stay visibly tied to library evidence.

Chosen direction: Transit Line, picked by the user over the rolled Card Catalog. Memorable moment: Home as a system map, with the stage line across the top and each job's own progress line.

Unresolved: dark-theme rendition of the signal colors; whether the job workspace header shows the job's line.

## Direction contract

THESIS: Each application rides one line through its stages, and the app is the system map. Refuses the gray-sidebar kanban with pastel pills that every job tracker ships.

OWN-WORLD: White ground, ink #111418, cool neutral grays. A black signage band carries navigation in white type with a 4px white underline on the current section. Four signal colors, one meaning each, used identically everywhere: red #EE352E needs your action, blue #0039A6 AI working, yellow #FCCC0A waiting on someone else, green #00933C offer or success. Round station bullets; thick colored line only where it means progress. Archivo for everything, with a real scale.

STORY: The user reads the stage line, sees which jobs carry a red bullet, and acts on those first; blue means the AI is on it, yellow means wait.

FIRST VIEWPORT: Home. 60px black band: brand bullet and name, then Home/Jobs/Library/Practice, bell and account at right. Below, the section's tabs where a section has them. Content: h1 "Your job search" with Find jobs and Add a job at right; AI work strip with the color legend; count plus Board/List; the station line across the full width with counts in bullets (Rejected as a branch); stage columns aligned under their stations, each job a tile with a five-stop progress line and its next step as a signal bullet plus label.

FORM: Transit Line, position 1 on the grounded list (chosen as IMPECCABLE'S PICK). seed:c9f93ec06ee8bd10

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
