# Build context: repository root.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY packages/signals/package.json packages/signals/
COPY packages/sdk-js/package.json packages/sdk-js/
COPY packages/sdk-react/package.json packages/sdk-react/
COPY packages/sdk-node/package.json packages/sdk-node/
COPY apps/server/package.json apps/server/
COPY apps/server/prisma apps/server/prisma
COPY apps/dashboard/package.json apps/dashboard/
COPY docs/package.json docs/
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY packages/signals packages/signals
COPY apps/dashboard apps/dashboard
RUN npm run build -w @tbdname/signals && npm run build -w tbdname-dashboard

FROM node:22-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/dashboard/.next/standalone ./
COPY --from=build /repo/apps/dashboard/.next/static ./apps/dashboard/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/dashboard/server.js"]
