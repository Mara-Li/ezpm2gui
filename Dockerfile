# syntax=docker/dockerfile:1.7

# @group Dependencies : Install reproducible build dependencies for server and client
FROM node:26.5.0-bookworm-slim AS dependencies

WORKDIR /app

ENV npm_config_update_notifier=false
ENV npm_config_fund=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g pnpm@11.15.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY src/client/package.json ./src/client/
RUN pnpm install --frozen-lockfile --ignore-scripts \
  && pnpm rebuild better-sqlite3

# @group Build : Compile the TypeScript server, CLI files, and React client
FROM dependencies AS build

COPY tsconfig.json tsconfig.bin.json ./
COPY bin ./bin
COPY scripts ./scripts
COPY src ./src

RUN pnpm --include-workspace-root -r run build
RUN pnpm prune --prod --ignore-scripts \
  && rm -rf src/client/node_modules

# @group Runtime : Run the compiled app with only production dependencies
FROM node:26.5.0-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3101
ENV HOME=/app
ENV PM2_HOME=/app/.pm2

RUN groupadd --system --gid 1001 ezpm2gui \
  && useradd --system --uid 1001 --gid ezpm2gui --home-dir /app --shell /usr/sbin/nologin ezpm2gui

COPY --from=build --chown=ezpm2gui:ezpm2gui /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build --chown=ezpm2gui:ezpm2gui /app/node_modules ./node_modules
COPY --from=build --chown=ezpm2gui:ezpm2gui /app/dist ./dist
COPY --from=build --chown=ezpm2gui:ezpm2gui /app/bin ./bin
COPY --from=build --chown=ezpm2gui:ezpm2gui /app/src/client/build ./src/client/build

# @group Persistence : Server runtime state (auth, remote connections, cron
# jobs, metrics DB) lives in $HOME/.ezpm2gui — see src/server/utils/data-dir.ts.
# Kept out of dist/ so it survives image/package updates, not just container restarts.
RUN mkdir -p /app/.pm2 /app/.ezpm2gui /app/uploads \
  && chown -R ezpm2gui:ezpm2gui /app

USER ezpm2gui

EXPOSE 3101

VOLUME ["/app/.pm2", "/app/.ezpm2gui", "/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "const http=require('http');const port=process.env.PORT||3101;const req=http.get({host:'127.0.0.1',port,path:'/'},res=>process.exit(res.statusCode<500?0:1));req.on('error',()=>process.exit(1));req.setTimeout(4000,()=>req.destroy());"

CMD ["node", "dist/server/index.js"]
