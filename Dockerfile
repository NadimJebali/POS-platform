# node:sqlite is built into the Node binary, so there's nothing to compile — a plain
# slim image is enough.
FROM node:24-slim

WORKDIR /app

# Install production deps against the lockfile for reproducible builds.
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/server.js"]
