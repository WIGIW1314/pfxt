#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-$ROOT_DIR/.deploy.env}"
RESTART_SCRIPT="${RESTART_SCRIPT:-$ROOT_DIR/restart-server.sh}"

if [[ -f "$DEPLOY_ENV_FILE" ]]; then
  # 允许服务器在仓库外逻辑不变的前提下，本地覆盖部署变量，例如 RESTART_CMD。
  set -a
  # shellcheck disable=SC1090
  source "$DEPLOY_ENV_FILE"
  set +a
fi

APP_NAME="${APP_NAME:-pfxt-server}"
BACKUP_DB="${BACKUP_DB:-1}"
RUN_DB_PUSH="${RUN_DB_PUSH:-0}"
SKIP_GIT_PULL="${SKIP_GIT_PULL:-0}"
NPM_INSTALL_CMD="${NPM_INSTALL_CMD:-npm ci}"
USE_PM2="${USE_PM2:-0}"
RESTART_CMD="${RESTART_CMD:-}"
ENV_FILE="$ROOT_DIR/server/.env"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1"
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "缺少命令：$1"
    exit 1
  fi
}

resolve_db_path() {
  local default_db="$ROOT_DIR/server/prisma/dev.db"
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "$default_db"
    return
  fi

  local database_url
  database_url="$(grep -E '^DATABASE_URL=' "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  database_url="${database_url%\"}"
  database_url="${database_url#\"}"

  if [[ -z "$database_url" || "$database_url" != file:* ]]; then
    echo "$default_db"
    return
  fi

  local db_target="${database_url#file:}"
  if [[ "$db_target" = /* ]]; then
    echo "$db_target"
    return
  fi

  echo "$(cd "$ROOT_DIR/server" && realpath -m "$db_target")"
}

require_cmd npm

cd "$ROOT_DIR"

if [[ "$SKIP_GIT_PULL" != "1" ]]; then
  require_cmd git

  if [[ ! -d .git ]]; then
    echo "当前目录不是 Git 仓库，无法执行 git pull。"
    exit 1
  fi

  current_branch="$(git rev-parse --abbrev-ref HEAD)"
  log "拉取最新代码（分支：$current_branch）"
  git fetch --all --prune
  git pull --ff-only origin "$current_branch"
fi

db_file="$(resolve_db_path)"
if [[ "$BACKUP_DB" == "1" && -f "$db_file" ]]; then
  backup_dir="$(dirname "$db_file")/backups"
  backup_file="$backup_dir/dev-$(date '+%Y%m%d%H%M%S').db"
  mkdir -p "$backup_dir"
  cp "$db_file" "$backup_file"
  log "已备份数据库到 $backup_file"
fi

log "安装依赖"
eval "$NPM_INSTALL_CMD"

log "构建前后端"
npm run build

if [[ "$RUN_DB_PUSH" == "1" ]]; then
  log "执行 Prisma 数据库同步"
  npm run prisma:dbpush --workspace server
fi

if [[ -n "$RESTART_CMD" ]]; then
  log "执行自定义重启命令"
  eval "$RESTART_CMD"
elif [[ -x "$RESTART_SCRIPT" ]]; then
  log "执行重启脚本：$RESTART_SCRIPT"
  "$RESTART_SCRIPT"
elif [[ "$USE_PM2" == "1" ]]; then
  require_cmd pm2
  if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
    log "重载 PM2 应用：$APP_NAME"
    pm2 reload ecosystem.config.cjs --only "$APP_NAME" --update-env
  else
    log "首次启动 PM2 应用：$APP_NAME"
    pm2 start ecosystem.config.cjs --only "$APP_NAME" --update-env
  fi
  pm2 save
else
  log "构建已完成。当前未启用 PM2，请到宝塔 Node 项目中执行重启，或配置 .deploy.env / restart-server.sh。"
fi

log "部署完成"
