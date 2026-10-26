---
target: study guide on Travelers job
total_score: 25
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 1
target_identity: "file:/home/jarrod/Desktop/resume_project/apps/web/src/features/study-guides/StudyGuideCard.tsx"
target_fingerprint: "sha256:59a91b0a423f762415a9c2047b6028f0bc4a1aeeed392ed0841c6b71a45efcbe"
target_path: /home/jarrod/Desktop/resume_project/apps/web/src/features/study-guides/StudyGuideCard.tsx
timestamp: 2026-10-26T05-25-22Z
slug: features-study-guides-studyguidecard-tsx-c9154ddd
---
Method: dual-agent (A: guide_design_review · B: guide_detector_review)

# Study guide review

Read mode. Inspected the saved Enterprise Generative AI Platform Engineering guide on the Travelers Software Engineer II job at http://localhost:5173/jobs/5743e426-ab59-4bfc-8e8f-d5589877fcdb .

The paper-and-forest styling fits Careergrind. The biggest opportunity is helping readers navigate and resume a study session. The deterministic scan returned zero findings for StudyGuideCard.tsx.

| Heuristic | Score /4 | Finding |
|---|---:|---|
| System status | 3 | Saved selection is visible; loading and failure states exist in source. |
| Familiar language | 3 | Clear practice labels and relevant material. |
| User control | 2 | Whole guide collapses; topics lack navigation. |
| Consistency | 3 | Matches surrounding workspace. |
| Error prevention | 3 | Source prevents duplicate generation and retains guides. |
| Recognition over recall | 2 | Topic location must be remembered. |
| Efficiency | 1 | Seven topics share a scrolling path. |
| Visual simplicity | 3 | Calm styling and readable measure. |
| Error recovery | 3 | Retry states exist in source; not exercised. |
| Help | 2 | Study method is implicit. |
| Total | 25/40 | Acceptable |

## Strengths

Readable constrained text width and line spacing. Predictable explanation, practice, and self-check structure. Concrete exercises tied to the saved job.

## Priority issues

1. [P1] No topic overview or jump navigation. Seven fully expanded topics make returning to a subject slow. Add a linked topic index and stronger topic headings. Suggested command: layout.
2. [P2] Study method is unclear. Static exercises ask users to write or draw without explaining where to work. Clarify expectations; answer criteria are a separate content enhancement. Suggested command: clarify.
3. [P2] Ending emphasizes regeneration. After the last self-check, Generate another guide is the only action. Add a route back to the topic index and retain regeneration as a secondary action. Suggested command: layout.

## Cognitive load and emotional journey

Moderate cognitive load: working memory and progressive disclosure are weak. Three exercises and three self-checks per topic are manageable groups; no observed action decision exceeded four choices. Opening is reassuring, but the long scroll lacks a finish or easy continuation.

## Personas

Alex cannot jump to a known weak topic. Jordan lacks self-checking instructions. Casey lacks a clear way to return after interruption; this is an interaction finding, not a mobile layout finding.

## Minor observations

Timestamp includes seconds and timezone. Topic headings could stand out more. Only one saved version was observed.

## Questions

Should the guide remain a reference document with topic links, or become a resumable study session? Should the next pass focus on navigation and layout, or navigation plus study-method copy?

## Evidence limitations

Desktop observed at 1265x712. Mobile viewport, measured contrast, complete keyboard flow, screen-reader behavior, generation and failure states were not exercised. Semantic headings, lists, labeled controls and expanded disclosure states were present. CLI detector returned [] with exit 0. No overlay injection because CUA evaluation is read-only. No live server or temporary browser assets were created.
