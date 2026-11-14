# Kuvos NEAR web app: Expo web export served by Caddy, which also proxies /api to the API and
# the documents bucket path to MinIO, so the browser talks to a single origin.
# Build context: repository root.
FROM node:24-slim AS build
RUN npm install -g pnpm@10.13.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/mobile-core/package.json packages/mobile-core/
RUN pnpm install --frozen-lockfile --filter @kuvos-near/web...
COPY packages/mobile-core packages/mobile-core
COPY apps/web apps/web
# EXPO_PUBLIC_* values are baked into the bundle at build time.
ARG EXPO_PUBLIC_API_URL=http://localhost:8090/api
ARG EXPO_PUBLIC_DEMO_SIGN_IN=true
ARG EXPO_PUBLIC_SOCIAL_SIGN_IN=false
ENV EXPO_PUBLIC_API_URL=$EXPO_PUBLIC_API_URL \
    EXPO_PUBLIC_DEMO_SIGN_IN=$EXPO_PUBLIC_DEMO_SIGN_IN \
    EXPO_PUBLIC_SOCIAL_SIGN_IN=$EXPO_PUBLIC_SOCIAL_SIGN_IN \
    CI=1
RUN pnpm --filter @kuvos-near/web build

FROM caddy:2.10-alpine
COPY docker/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
