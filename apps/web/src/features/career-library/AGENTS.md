# AGENTS.md — features/career-library

## Purpose

The career library page (`/library`): experiences with highlights, projects, education, skills,
and the user's resumes. Read-only for now.

## Contents

- `CareerLibraryPage.tsx` — page; `LibrarySection.tsx`, `LibraryEntry.tsx`, `SkillList.tsx`,
  `ResumeList.tsx` — display pieces
- `careerLibraryOperations.ts` — one query for the whole library; `useCareerLibrary.ts` — hook
  (`cache-and-network`, so a fresh import shows up)
- `groupSkillsByCategory.ts` — skill grouping helper
- `*.test.ts(x)` — page and grouping tests
