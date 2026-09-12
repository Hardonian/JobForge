FROM node:20-alpine AS base
RUN npm install -g pnpm@8.15.0
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY packages/ packages/
COPY apps/web/ apps/web/

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @jobforge/shared build
RUN pnpm --filter @jobforge/ui build
RUN pnpm --filter @jobforge/design-system build
RUN pnpm --filter @jobforge/web build

EXPOSE 3000
ENV PORT=3000
CMD ["pnpm", "--filter", "@jobforge/web", "start"]
