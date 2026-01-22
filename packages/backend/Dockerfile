# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* ./

# Install dependencies
RUN corepack enable && yarn install --frozen-lockfile

# Copy source
COPY . .

# Build TypeScript
RUN yarn build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json yarn.lock* ./

# Install production dependencies only
RUN corepack enable && yarn workspaces focus --production

# Copy built files
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start server
CMD ["node", "dist/index.js"]
