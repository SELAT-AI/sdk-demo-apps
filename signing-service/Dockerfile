# Long-lived host for the Circle CLI. NOT serverless — that is the whole point.
FROM node:20-slim

WORKDIR /app

# Install dependencies (includes @circle-fin/cli).
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund

# Build.
COPY tsconfig.json ./
COPY src ./src
RUN npm install --no-audit --no-fund && npm run build

ENV PORT=8787
EXPOSE 8787

# IMPORTANT: the Circle CLI must be authenticated in this container at runtime.
# See README "Authenticating the Circle CLI" — mount the CLI config/session or
# run `circle login` into a persistent volume. An unauthenticated CLI returns
# 502 from /sign.
CMD ["npm", "start"]
