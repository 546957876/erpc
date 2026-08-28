#!/usr/bin/env bash
set -Eeuo pipefail

# One-shot deployment for the isolated Admin/Web/eRPC stack.

if [[ ${EUID} -ne 0 ]]; then
  echo "请使用 root 运行此脚本" >&2
  exit 1
fi

IMAGE_REPO=${IMAGE_REPO:-ghcr.io/546957876}
IMAGE_TAG=${IMAGE_TAG:-}
DOMAIN=${DOMAIN:-}
BASE_DIR=${BASE_DIR:-/root/erpc-admin-prod}
NETWORK=${NETWORK:-erpc-admin-prod-net}
WEB_PORT=${WEB_PORT:-18180}
RPC_PORT=${RPC_PORT:-14000}
ADMIN_PORT=${ADMIN_PORT:-14001}
POSTGRES_IMAGE=${POSTGRES_IMAGE:-dockerproxy.net/library/postgres:16-alpine}
DB_PASSWORD_FILE=${DB_PASSWORD_FILE:-$BASE_DIR/.db_password}

if [[ -z "$IMAGE_TAG" ]]; then
  echo "请设置 IMAGE_TAG，例如 IMAGE_TAG=5929dd..." >&2
  exit 1
fi
command -v docker >/dev/null || { echo "未安装 Docker" >&2; exit 1; }

mkdir -p "$BASE_DIR"
chmod 700 "$BASE_DIR"
if [[ ! -s "$DB_PASSWORD_FILE" ]]; then
  umask 077
  openssl rand -hex 24 > "$DB_PASSWORD_FILE"
fi
DB_PASSWORD=$(<"$DB_PASSWORD_FILE")

docker pull "$IMAGE_REPO/erpc-admin:$IMAGE_TAG"
docker pull "$IMAGE_REPO/erpc-web:$IMAGE_TAG"
docker pull "$POSTGRES_IMAGE"
docker network inspect "$NETWORK" >/dev/null 2>&1 || docker network create "$NETWORK" >/dev/null

docker rm -f erpc-web-prod erpc-admin-prod erpc-admin-postgres-prod >/dev/null 2>&1 || true

docker run -d --name erpc-admin-postgres-prod --network "$NETWORK" --restart unless-stopped \
  -e POSTGRES_USER=erpc -e POSTGRES_PASSWORD="$DB_PASSWORD" -e POSTGRES_DB=erpc_admin \
  -v erpc_admin_prod_pgdata:/var/lib/postgresql/data "$POSTGRES_IMAGE" >/dev/null

for _ in $(seq 1 30); do
  docker exec erpc-admin-postgres-prod pg_isready -U erpc -d erpc_admin >/dev/null 2>&1 && break
  sleep 2
done
docker exec erpc-admin-postgres-prod pg_isready -U erpc -d erpc_admin >/dev/null

docker run -d --name erpc-admin-prod --network "$NETWORK" --network-alias admin --restart unless-stopped \
  -e ERPC_ADMIN_DATABASE_URL="postgres://erpc:${DB_PASSWORD}@erpc-admin-postgres-prod:5432/erpc_admin?sslmode=disable" \
  -v erpc_admin_prod_runtime:/var/lib/erpc-admin \
  -p "127.0.0.1:${ADMIN_PORT}:8090" -p "127.0.0.1:${RPC_PORT}:4000" \
  "$IMAGE_REPO/erpc-admin:$IMAGE_TAG" >/dev/null

docker run -d --name erpc-web-prod --network "$NETWORK" --restart unless-stopped \
  -p "127.0.0.1:${WEB_PORT}:80" "$IMAGE_REPO/erpc-web:$IMAGE_TAG" >/dev/null

if [[ -n "$DOMAIN" && -d /etc/nginx/sites-enabled && -d /etc/nginx/sites-available ]]; then
  rm -f "/etc/nginx/sites-enabled/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
  cat > "/etc/nginx/sites-available/${DOMAIN}.conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    location / { proxy_pass http://127.0.0.1:${WEB_PORT}; proxy_set_header Host \$host; proxy_set_header X-Real-IP \$remote_addr; proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for; proxy_set_header X-Forwarded-Proto \$scheme; }
}
NGINX
  ln -sfn "/etc/nginx/sites-available/${DOMAIN}.conf" "/etc/nginx/sites-enabled/${DOMAIN}.conf"
  nginx -t && systemctl reload nginx
  if command -v certbot >/dev/null; then
    certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
  fi
  if [[ -s "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
    cat > "/etc/nginx/sites-available/${DOMAIN}.conf" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name ${DOMAIN};
    ssl_certificate /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    location / {
        proxy_pass http://127.0.0.1:${WEB_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX
    nginx -t && systemctl reload nginx
  fi
fi

docker ps --filter name=erpc-admin-prod --filter name=erpc-web-prod --filter name=erpc-admin-postgres-prod \
  --format '{{.Names}} {{.Status}} {{.Ports}}'
echo "部署完成：Web 端口 ${WEB_PORT}，RPC 端口 ${RPC_PORT}，Admin API 端口 ${ADMIN_PORT}（均仅本机监听）"
