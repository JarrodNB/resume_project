# AGENTS.md — apps/landing

## Purpose

Public marketing landing page. Explains the product and redirects to `apps/web` for sign-up/login.

## Stack

Vite + React + TypeScript (static build), same tooling as `apps/web`.

## Local Rules

- Static only: no auth, no API calls beyond an optional waitlist form.
- Keep it fast and simple.
- Follow the root documentation rules; use JSDoc for public contracts and non-obvious behavior.

## Contents

Generated with `create-vite` (React + TypeScript template, Vite 8, oxlint).

- `src/` — still the Vite starter; replaced when the landing page step begins
- `vite.config.ts` — dev server on `0.0.0.0:5174`
- `Dockerfile.dev` — local dev image; `node_modules` lives in a container volume
