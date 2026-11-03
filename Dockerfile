# ==========================================
# Build stage: compile the server and bundle the web app.
# ==========================================
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85 AS build

WORKDIR /app

# Install all dependencies first to improve Docker layer caching.
COPY package*.json ./
RUN npm ci

COPY tsconfig*.json vite.config.ts ./
COPY server ./server
COPY shared ./shared
COPY web ./web
RUN npm run build

# ==========================================
# Runtime stage: production dependencies and build output only.
# ==========================================
FROM node:24-alpine@sha256:8a32c8cf649a49915a66e81e7a609223c708d0adabf288ee3f4077d765542f85

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY sources.yml gamification.yml ./

# The SQLite database lives in a volume mounted here; the node user must own it.
RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000

# Run node directly so it receives SIGTERM from Docker. node:sqlite still warns that it is experimental.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
