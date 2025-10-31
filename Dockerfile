# Use official Bun image
FROM oven/bun:1.3.0 AS base

# Set working directory
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./

# Install dependencies
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Generate agent manifest
RUN bun run manifest > .well-known/agent.json

# Expose port (default 8787)
EXPOSE 8787

# Set environment variables
ENV NODE_ENV=production
ENV PORT=8787

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD bun run -e "fetch('http://localhost:8787/.well-known/agent.json').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the application
CMD ["bun", "run", "src/index.ts"]
