# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

FROM base AS dependencies
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=dependencies /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATA_DIR=/data \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# ffmpeg extracts audio and yt-dlp retrieves supported remote media.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3-pip ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages yt-dlp \
    && apt-get purge -y python3-pip \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

# Attach a Railway Volume at /data. Without one, the app still starts but its
# database is ephemeral, which is useful for preview deployments only.
RUN mkdir -p /data && chown -R node:node /app /data
USER node
EXPOSE 3000
CMD ["node", "server.js"]
