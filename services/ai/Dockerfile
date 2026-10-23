# Build the worker's PDF renderer from the same web source used by preview and downloads.
FROM node:22-slim AS resume-renderer
WORKDIR /render
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/src/features/resume-tailoring/ResumePdfDocument.tsx apps/web/src/features/resume-tailoring/resumeMarkdown.ts apps/web/src/features/resume-tailoring/renderResumePdf.tsx ./src/
RUN ./node_modules/.bin/rolldown src/renderResumePdf.tsx --platform node --format esm --external @react-pdf/renderer --external react --external react/jsx-runtime --file render.mjs \
    && npm prune --omit=dev

# Rails owns writes; this image only reads task inputs and publishes queue results.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1
COPY services/ai/pyproject.toml services/ai/uv.lock ./
RUN uv sync --frozen
RUN uv sync --frozen --no-dev --offline
COPY --from=resume-renderer /usr/local/bin/node /usr/local/bin/node
COPY --from=resume-renderer /render/node_modules /opt/resume-renderer/node_modules
COPY --from=resume-renderer /render/render.mjs /opt/resume-renderer/render.mjs
COPY services/ai/ ./
RUN python -c "import spacy; spacy.load('en_core_web_sm')"
CMD ["python", "-m", "worker.main"]
