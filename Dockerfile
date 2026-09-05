# 本体(オーケストレーター)をコンテナで動かすためのイメージ(issue #90)。
# プレビュー環境は**ホストのdockerデーモン**上に作るため(Docker-out-of-Docker)、
# docker CLI + compose/buildxプラグインとgitを同梱し、実行時に /var/run/docker.sock を
# バインドマウントする。コンテナ内にデーモンは持たない。
# buildxはCLIプラグインなので、ホスト側に入っていてもコンテナ側に必要。無いと
# compose buildがクラシックビルダーへフォールバックし、BuildKit専用機能
# (RUN --mount / --secret / --ssh / 追加コンテキスト等)を使う対象リポジトリの
# ビルドが壊れる(issue #101)。
FROM node:26-trixie-slim

# Dockerのaptリポジトリはベースイメージのコードネームに追従させる(ベース更新時に
# この行を書き換え忘れないように/etc/os-releaseから取得する)。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl git gnupg \
 && install -m 0755 -d /etc/apt/keyrings \
 && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
 && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends docker-ce-cli docker-compose-plugin docker-buildx-plugin \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 依存インストールをソースと分離してレイヤーキャッシュを効かせる。postinstallの
# prisma generate が schema と prisma.config.ts を要求するため、先にコピーする。
COPY package.json package-lock.json ./
COPY server/package.json server/prisma.config.ts ./server/
COPY web/package.json ./web/
COPY server/prisma ./server/prisma
RUN npm ci --include=dev

COPY . .
RUN npm run build

# ビルド後はvite/vue-tsc/tsup等のdevDependenciesを落とす。マイグレーションに使う
# prisma CLIはserverのdependenciesなので残る。
RUN npm prune --omit=dev

ENV NODE_ENV=production
# 既定値。docker-compose.yml ではホストと同じ絶対パス(${DATA_DIR})で上書きする。
ENV DATABASE_URL=file:/data/app.db
ENV WORKSPACES_DIR=/data/workspaces
ENV METRICS_DISK_PATH=/data

# VOLUME は宣言しない。compose では ${DATA_DIR} を同一パスでマウントするため、
# /data の匿名ボリュームが起動のたびに増えるのを避ける。
EXPOSE 8787
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
