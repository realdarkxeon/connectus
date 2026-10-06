# One image, two Railway services: api (node apps/api/src/server.ts) and
# worker (node apps/api/src/worker.ts). Node 24 runs TypeScript directly; no build step.

# Stage 1: the pinned Supabase CLI (a devDependency), used by the pre-deploy migration.
FROM node:24-slim AS tools
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /tools
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/adapters/package.json packages/adapters/
COPY packages/evals/package.json packages/evals/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter connectus \
 && bin="$(ls -d node_modules/.pnpm/@supabase+cli-linux-*/node_modules/@supabase/cli-linux-*/bin | grep -v musl | head -n 1)" \
 && cp -rL "$bin" /tools/supabase-bin


# Stage 2: the runtime.
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

COPY --from=tools /tools/supabase-bin /opt/supabase/bin
ENV PATH=/opt/supabase/bin:$PATH
COPY packages ./packages
COPY apps ./apps
COPY supabase/config.toml supabase/
COPY supabase/migrations supabase/migrations
COPY scripts ./scripts
COPY certs ./certs

USER node
EXPOSE 3000
CMD ["node", "apps/api/src/server.ts"]
