# syntax=docker/dockerfile:1

# Build the React front end with the exact dependency versions from the lockfile.
FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Runtime: one Node process serves the built React app and the Express API.
FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production \
    API_PORT=3001 \
    DATABASE_PATH=/data/bettergo.db \
    UPLOADS_DIR=/data/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY server ./server
COPY scripts ./scripts
COPY .env.example ./.env.example
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
EXPOSE 3001
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.js"]
