# AGENTS.md — apps

Frontend applications.

- `web/` — main React app
- `landing/` — public landing page

See each subfolder's `AGENTS.md` for local rules.

## File Header Format (shared by all apps)

Every TypeScript/TSX file starts with:

```ts
/**
 * Description: Kanban board showing saved jobs grouped by application stage.
 * Index:
 *   - JobBoard: page component
 *   - groupJobsByStage: groups jobs into stage columns
 */
```

Every exported function, component, and hook gets a JSDoc comment describing what it does.
