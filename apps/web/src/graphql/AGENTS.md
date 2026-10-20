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

HTTP includes browser credentials and the current Rails CSRF token, including
multipart uploads. Cable uses the cookie session without URL tokens. Dispose old
connections and caches on session changes; a CSRF token is not a user identity.
