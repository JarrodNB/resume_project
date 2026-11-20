# Description: Production image shared by the AI HTTP app, MCP tool server and queue worker. The compose
# file picks the process with `command`. Unlike Dockerfile.dev, the source is copied in, not mounted.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim

WORKDIR /app
# Decode and inspect actual interview recordings with bounded local subprocesses.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# The pinned model is installed by uv, never fetched while processing a resume.
# Fail the build if the local English NLP assets cannot load on this Python version.
RUN python -c "import spacy; spacy.load('en_core_web_sm')"

# Run as an unprivileged user; HF_HOME gives model caches a writable home. Copy with --chown:
# a separate chown step would store a second full copy of the code in the image.
RUN useradd --system --uid 1000 --create-home app
COPY --chown=app:app . .
USER 1000
ENV HF_HOME=/home/app/.cache/huggingface

CMD ["python", "-m", "worker.main"]
