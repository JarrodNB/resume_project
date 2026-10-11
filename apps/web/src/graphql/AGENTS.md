# AGENTS.md — apps/web/src/graphql

## Purpose

Apollo transport, session isolation, errors, and generated operation types.

## Contents

- `SessionApolloProvider.tsx`
- `createApolloClient.ts`
- `generated` — subfolder; inherits these rules unless overridden locally.
- `requestErrorMessage.test.ts`
- `requestErrorMessage.ts`

## Local Rules

Replace the client when the session changes. Preserve HTTP and ActionCable authentication. Regenerate generated/ through npm run codegen in Docker; never edit generated types by hand.
