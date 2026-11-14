# Kuvos NEAR API (NestJS + Prisma). Build context: repository root.
FROM node:24-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/* && npm install -g pnpm@10.13.1
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/mobile-core/package.json packages/mobile-core/
RUN pnpm install --frozen-lockfile --filter @kuvos-near/api...
COPY apps/api apps/api
RUN pnpm --filter @kuvos-near/api build

FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
# The Prisma CLI (a dev dependency) stays in the image so the `migrate` service can run it.
COPY --from=build /app /app
RUN mkdir -p /data && chown node /data
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["node", "dist/main"]
