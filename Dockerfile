# food.st44.no app image. Single-stage — there is no bundler, so no build stage.
# Base image is pinned by digest so the same commit always produces the same artifact.
FROM node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY views ./views
COPY public ./public

ENV PORT=80
ENV DB_PATH=/data/recipes.db

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["node", "--experimental-sqlite", "src/server.js"]
