# Testing and verification

Run commands from the checkout being changed. All application tools run in Docker.
Choose checks for the behavior you touched; documentation-only edits need link and diff
checks, not the full application suite.

## Focused checks

| Change | Command |
| --- | --- |
| Rails behavior | `docker compose run --rm api bundle exec rspec spec/path/to_spec.rb` |
| AI worker behavior (offline) | `docker compose run --rm ai pytest -m "not db" tests/test_example.py` |
| AI schema dependency direction | `docker compose run --rm ai pytest tests/test_schema_dependencies.py` |
| AI lint | `docker compose run --rm ai ruff check .` |
| Frontend behavior | `docker compose run --rm --no-deps web npm test -- src/path/Thing.test.tsx` |
| Frontend types | `docker compose run --rm --no-deps web npm run typecheck` |
| Frontend lint | `docker compose run --rm --no-deps web npm run lint` |

Replace example test paths with the relevant files. Omit the test path to run the full
suite. AI tests disable real model requests and remote tracing; only `db`-marked tests
use Postgres and roll back their writes. Run the full AI suite without the marker filter
to include those tests; database tests may skip if Postgres is unavailable. API specs
need the Compose database. See each service's `AGENTS.md` for fixtures and local rules.

## GraphQL contracts

After Rails GraphQL changes, export the schema before generating frontend types:

```bash
docker compose run --rm api bin/rails graphql:schema:dump
docker compose run --rm --no-deps web npm run codegen
```

Commit the schema and generated types together. The API schema-dump spec checks that
its SDL matches the implementation. Never edit generated files by hand.

## AI quality evaluations

Run the relevant `services/ai/evals/run_*_evals.py` runner after prompt, model, retrieval,
or agent behavior changes, for example:

```bash
docker compose run --rm ai python -m evals.run_library_retrieval_evals
docker compose run --rm ai python -m evals.run_interview_questions_evals
```

These evaluations call external providers and incur charges. Configure credentials in
ignored environment files first; generative evals also need TypeSafe screening credentials.
Use synthetic or anonymized cases. Pytest tests correctness with fakes; evaluations measure
model quality. See `services/ai/evals/AGENTS.md` for runners and reporting options.

## Synthetic resume import samples

Build uploadable PDF/DOCX controls and grouped, separate, mixed-scope, and wrapped
examples from the hand-labelled parsing dataset:

```bash
mkdir -p /tmp/resume-import-fixtures
docker compose run --rm -v /tmp/resume-import-fixtures:/fixtures ai \
  python -m evals.resume_import_fixtures /fixtures
```

The output includes source text and expected YAML beside each file for human import
review. The wrapped case contains physical page breaks through bullet continuations.
All employers and accomplishments are synthetic. Offline parser tests use fake source
selections; the live parsing comparison is needed to measure model grouping quality.

## Isolated worktrees

Use `run` from the worktree instead of `exec`, which may target a container mounted from a
different checkout. Give a separate stack a unique project name (`docker compose -p <name>`)
and avoid starting port-publishing services alongside the main stack without port overrides.
A new project also has separate dependency/database volumes and may need setup or an image
build. Do not copy production secrets or reset the main stack's volumes to make tests pass.

For an offline AI check with an existing compatible development image, mount the worktree
explicitly; no database, queue, or environment file is needed:

```bash
docker run --rm --network none -v "$PWD/services/ai:/app" -w /app \
  resume_project-ai:latest pytest -m "not db" tests/test_schema_dependencies.py
```

Rebuild the image if its dependencies differ from the checkout's lockfile.

## Offline spoken interview recovery

See [the isolated recovery guide](interview-demo.md) for deterministic process recovery
without paid providers. [Real browser QA](interview-real-qa.md) uses the original paid
ledger and `127.0.0.2`, keeping cookies separate from a main stack on `localhost`.

For a bounded, no-network timing probe of spoken turn completion → dependent
speech claim, see [interview latency measurements](interview-latency.md). It uses
the actual recovery scheduler with synthetic work, not real providers or browser QA.
