# AGENTS.md — apps/web/src/lib

## Purpose

Shared formatting, configuration, theme state, and text limits.

## Contents

- `apiConfig.ts`
- `colorTheme.ts`
- `formatCertificationDates.test.ts`
- `formatCertificationDates.ts`
- `formatDateRange.test.ts`
- `formatDateRange.ts`
- `openSections.test.ts`
- `openSections.ts`
- `productName.ts`
- `textLimits.ts`
- `utils.ts`

## Local Rules

Keep helpers independent of feature pages. INTERVIEW_ANSWER_TEXT is 2,000 and must match Rails TextLimits::INTERVIEW_ANSWER and Python MAX_INTERVIEW_ANSWER.
