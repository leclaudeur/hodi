# ==========================================
# Build stage: compile the server and bundle the web app.
# ==========================================
# The build machine's own processor: its output is the same JavaScript for every target, and npm under emulation can
# hang for good.
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS build

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
# Production dependencies, installed on the build machine's processor for the target's: only sharp has a binary, and
# npm picks its build from --os, --cpu and --libc.
# ==========================================
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5 AS deps
ARG TARGETARCH

WORKDIR /app

COPY package*.json ./
RUN cpu=$([ "$TARGETARCH" = amd64 ] && echo x64 || echo "$TARGETARCH") \
  && npm ci --omit=dev --os=linux --cpu="$cpu" --libc=musl \
  && npm cache clean --force \
  && mkdir data

# ==========================================
# Runtime stage: production dependencies and build output only.
# ==========================================
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY sources.yml gamification.yml ./

# The SQLite database lives in a volume mounted here; the node user must own it.
COPY --from=deps --chown=node:node /app/data ./data

USER node

EXPOSE 3000

# Run node directly so it receives SIGTERM from Docker. node:sqlite still warns that it is experimental.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server/index.js"]
