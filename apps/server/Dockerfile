# Build context: repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
# Every workspace manifest, so npm ci matches the lockfile.
COPY packages/signals/package.json packages/signals/
COPY packages/embed/package.json packages/embed/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY packages/sdk-vue/package.json packages/sdk-vue/
COPY packages/sdk-svelte/package.json packages/sdk-svelte/
COPY packages/sdk-node/package.json packages/sdk-node/
COPY packages/sdk-react-native/package.json packages/sdk-react-native/
COPY packages/ip-intel/package.json packages/ip-intel/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/proxy-cloudflare/package.json packages/proxy-cloudflare/
COPY apps/server/package.json apps/server/
COPY apps/dashboard/package.json apps/dashboard/
COPY apps/server/prisma apps/server/prisma
RUN npm ci --no-audit --no-fund
COPY packages/signals packages/signals
COPY packages/embed packages/embed
COPY packages/sdk-node packages/sdk-node
COPY packages/ip-intel packages/ip-intel
COPY packages/sdk-js packages/sdk-js
COPY apps/server apps/server
RUN npm run build -w @trace-id/signals \
 && npm run build -w @trace-id/sdk-node \
 && npm run build -w @trace-id/ip-intel \
 && npm run build -w @trace-id/embed \
 && npm run build -w @trace-id/sdk-js \
 && npm run build -w trace-server \
 && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/signals/package.json packages/signals/package.json
COPY --from=build /repo/packages/signals/dist packages/signals/dist
COPY --from=build /repo/packages/embed/package.json packages/embed/package.json
COPY --from=build /repo/packages/embed/dist packages/embed/dist
COPY --from=build /repo/packages/sdk-node/package.json packages/sdk-node/package.json
COPY --from=build /repo/packages/sdk-node/dist packages/sdk-node/dist
COPY --from=build /repo/packages/ip-intel/package.json packages/ip-intel/package.json
COPY --from=build /repo/packages/ip-intel/dist packages/ip-intel/dist
COPY --from=build /repo/packages/sdk-js/package.json packages/sdk-js/package.json
COPY --from=build /repo/packages/sdk-js/dist packages/sdk-js/dist
COPY --from=build /repo/apps/server/package.json apps/server/package.json
# Packages npm could not hoist (Prisma, Better Auth) live in the workspace's own node_modules.
COPY --from=build /repo/apps/server/node_modules apps/server/node_modules
COPY --from=build /repo/apps/server/dist apps/server/dist
COPY --from=build /repo/apps/server/prisma apps/server/prisma
COPY --from=build /repo/apps/server/prisma.config.ts apps/server/prisma.config.ts
COPY scoring.default.json ./
WORKDIR /app/apps/server
USER node
EXPOSE 8080
CMD ["sh", "-c", "npx --no-install prisma migrate deploy && exec node dist/main.js"]
