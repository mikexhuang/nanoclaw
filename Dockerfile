FROM node:22-slim

# System deps for Chromium (agent-browser) and general utilities
RUN apt-get update && apt-get install -y \
    chromium fonts-liberation fonts-noto-color-emoji \
    libgbm1 libnss3 libatk-bridge2.0-0 libgtk-3-0 \
    curl git && rm -rf /var/lib/apt/lists/*

ENV AGENT_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium

# Install claude-code globally (agent SDK for direct execution mode)
RUN npm install -g @anthropic-ai/claude-code

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN npm run build

# Railway volume mounts at /store for persistent data
# Contains: auth/ (Baileys credentials), messages.db (SQLite), config/ (allowlists)
ENV STORE_DIR=/store
ENV EXECUTION_MODE=direct
ENV NODE_ENV=production

# Create /store directories (Railway volume will overlay)
RUN mkdir -p /store/auth /store/config

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
