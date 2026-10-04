# AGENTS.md — apps/web

## Purpose

The main user-facing app: resume builder, job board, gap analysis chat, application tracking.

## Stack

Vite 8, React 19, TypeScript, React Router 8 (data router), Apollo Client 4, Tailwind CSS 4 +
shadcn/ui (radix-nova style, `cn` from shadcn's `cn` package), `@dnd-kit/react` +
`@dnd-kit/helpers` (drag and drop), GraphQL Code Generator (client preset), Vitest 5 +
Testing Library, oxlint.

## Local Rules

- Components are small and single-purpose; split when a component handles more than one concern.
- Data fetching lives in hooks (`useTailoredResume`), not inline in components.
- GraphQL operations live next to the feature that uses them (`<feature>Operations.ts`), written
  with `graphql(...)` from `@/graphql/generated`. After adding or changing one, run
  `docker compose exec web npm run codegen` and commit the generated files.
- The schema comes from Rails: after any GraphQL change in `services/api`, run
  `docker compose run --rm api bin/rails graphql:schema:dump` first (a Rails spec fails if
  `services/api/schema.graphql` is stale).
- Live updates (AI task progress, questions from the AI) come from GraphQL subscriptions over
  an ActionCable link in Apollo. Don't poll.
- Organize by feature (`src/features/resumes/`, `src/features/jobs/`), with shared UI in `src/components/`.
- Use shadcn/ui components from `src/components/ui/` (add more with
  `docker compose exec -T web npx shadcn@latest add <name> -y`); they are generated and exempt
  from the header rule and lint.
- Tests sit next to the code they test (`Thing.test.tsx`). Page tests use `renderPage` from
  `src/test/` (memory router + Apollo `MockedProvider`; mocks must include `__typename`).
- File header format: see `apps/AGENTS.md`.

## Contents

- `src/` — app source (see `src/AGENTS.md`)
- `codegen.ts` — GraphQL Code Generator config; reads `../../services/api/schema.graphql`
  (mounted read-only into the container at the same relative path)
- `components.json` — shadcn/ui config
- `vite.config.ts` — React + Tailwind plugins, `@` alias to `src/`, dev server on
  `0.0.0.0:5173`, Vitest (jsdom) config
- `.oxlintrc.json` — lint rules (ignores `src/components/ui/` and `src/graphql/generated/`)
- `Dockerfile.dev` — local dev image; `node_modules` lives in a container volume

## Commands

- Tests: `docker compose exec web npm test`
- Type check: `docker compose exec web npm run typecheck`
- Lint: `docker compose exec web npm run lint`
- Add a package: `docker compose run --rm --no-deps web npm install <package>`, then
  `docker compose up --build -V -d web`

The API URL defaults to `http://localhost:3000`; override with `VITE_API_URL`.
