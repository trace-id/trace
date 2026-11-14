# Build context: repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/signals/package.json packages/signals/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY packages/sdk-node/package.json packages/sdk-node/
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
RUN npm ci --no-audit --no-fund
COPY packages/signals packages/signals
COPY apps/server apps/server
RUN npm run build -w @tbdname/signals \
 && npm run build -w tbdname-server \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/signals/package.json packages/signals/package.json
COPY --from=build /repo/packages/signals/dist packages/signals/dist
COPY --from=build /repo/apps/server/package.json apps/server/package.json
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/prisma apps/server/prisma
COPY scoring.default.json ./
WORKDIR /app/apps/server
USER node
EXPOSE 8080
CMD ["sh", "-c", "node ../../node_modules/prisma/build/index.js migrate deploy && exec node dist/main.js"]
