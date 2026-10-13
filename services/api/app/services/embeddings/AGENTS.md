# AGENTS.md — embeddings

## Purpose and Contents

- `open_ai_embedding_client.rb` — embeds batches and yields reported token usage and estimated cost.
- `mask_contact.rb` — masks user contact details before requests.

## Rules

Follow parent service rules. Validate model pricing before calling OpenAI. Yield usage immediately
after each response so completed batches remain charged when a later batch fails.
