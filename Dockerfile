# One image, two Railway services: api (node apps/api/src/server.ts) and
# worker (node apps/api/src/worker.ts). Node 24 runs TypeScript directly; no build step.
FROM node:24-slim

ENV NODE_ENV=production \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

WORKDIR /app

# Manifests first, so dependency layers are cached between code changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY packages/evals/package.json packages/evals/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --prod

COPY packages ./packages
COPY apps ./apps

USER node
EXPOSE 3000
CMD ["node", "apps/api/src/server.ts"]
