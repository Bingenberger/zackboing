FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS dependencies
ENV npm_config_cache=/tmp/npm-cache npm_config_devdir=/tmp/node-gyp npm_config_nodedir=/usr/local MAKEFLAGS=-j2
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
    && node -e "const db=require('better-sqlite3')(':memory:');db.close();"

FROM dependencies AS tests
RUN npm ci --no-audit --no-fund
COPY server ./server
COPY public ./public
COPY docs ./docs
COPY test ./test
USER 10001:10001

FROM node:22.23.4-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da AS runtime
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0 ZACKBOING_DATA=/data
WORKDIR /app
COPY --from=dependencies /build/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server ./server
COPY public ./public
COPY docs ./docs
RUN groupadd --gid 10001 zackboing && useradd --uid 10001 --gid 10001 --no-create-home zackboing \
    && mkdir -p /data && chown 10001:10001 /data && chmod 700 /data
USER 10001:10001
EXPOSE 3000
CMD ["node", "server/index.js"]
