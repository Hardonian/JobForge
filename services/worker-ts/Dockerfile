FROM node:20-alpine AS base
RUN npm install -g pnpm@8.15.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/ packages/
COPY services/worker-ts/ services/worker-ts/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jobforge/shared build
RUN pnpm --filter @jobforge/sdk-ts build
RUN pnpm --filter @jobforge/worker-ts build

CMD ["node", "services/worker-ts/dist/cli.js"]
