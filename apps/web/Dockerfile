# Description: Production image for the web app. Builds the static site, then serves it with Caddy.
# VITE_* values are baked into the JavaScript at build time, so pass them as build args.
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_API_URL
ARG VITE_TURNSTILE_SITE_KEY
ENV VITE_API_URL=$VITE_API_URL \
    VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY

RUN npm run build

FROM caddy:2-alpine

# Unknown paths fall back to index.html so client-side routes survive a reload.
COPY <<'EOF' /etc/caddy/Caddyfile
{
	admin off
}

:80 {
	root * /srv
	encode zstd gzip
	try_files {path} /index.html
	file_server
}
EOF

COPY --from=build /app/dist /srv

EXPOSE 80
