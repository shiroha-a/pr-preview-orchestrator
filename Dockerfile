# Single image for both roles (issue #80): the orchestrator (default) and the
# build agent (SERVER_MODE=agent). The agent needs the docker CLI + compose
# plugin and git; it talks to the host daemon via /var/run/docker.sock.
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# インストールとビルドを1レイヤーで実行する(postinstallのprisma generateが
# server/prisma/schema.prisma を要求するため、先に全ソースをコピーする)。
COPY . .
RUN npm ci --include=dev && npm run build

ENV NODE_ENV=production
ENV WORKSPACES_DIR=/data/workspaces
ENV DATABASE_URL=file:/data/app.db
VOLUME /data

# オーケストレーターとして起動する場合のみマイグレーションを適用する。
# エージェント(SERVER_MODE=agent)はDBを持たないためスキップする。
CMD ["sh", "-c", "if [ \"$SERVER_MODE\" != \"agent\" ]; then cd server && npx prisma migrate deploy && cd ..; fi && npm run start"]
