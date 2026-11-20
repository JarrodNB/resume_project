# Description: Production image for the landing page. Builds and prerenders the static site, then
# serves it with Caddy.
FROM node:22-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into the sign-up links at build time; the build refuses to run without it.
ARG VITE_APP_URL
ENV VITE_APP_URL=$VITE_APP_URL

RUN npm run build

FROM caddy:2-alpine

COPY <<'EOF' /etc/caddy/Caddyfile
{
	admin off
}

:80 {
	root * /srv
	encode zstd gzip
	file_server
}
EOF

COPY --from=build /app/dist /srv

EXPOSE 80
