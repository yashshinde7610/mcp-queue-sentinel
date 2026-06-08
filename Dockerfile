FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm (or use npm)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner

WORKDIR /app

COPY --from=builder /app/package.json /app/package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Expose monitoring port
EXPOSE 3001

# The main MCP server runs on stdio, but docker-compose can just run it
CMD ["node", "dist/index.js"]
