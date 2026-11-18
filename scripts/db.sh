#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/compose.yaml"
CONTAINER="nav-mysql"
BACKUP_DIR="$ROOT/docker/backup"
DATA_DIR="$ROOT/docker/data/mysql"

ACTION="status"
SITE="jubt5"
FILE=""
KEEP=14

usage() {
  cat <<'EOF'
用法: scripts/db.sh [动作] [选项]

动作:
  up        启动容器并等待 healthy
  down      停止容器（数据目录保留）
  status    列出库内各表行数（默认动作）
  import    生成并导入 MySQL SQL（库内已有表时先自动备份）
  backup    立即备份数据库
  restore   回滚到指定备份，缺省取最新一份
  reset     停容器并把数据目录改名保留（不删除）
  shell     进入 mysql 交互终端

选项:
  -s, --site <名称>   导入所用站点名，默认 jubt5
  -f, --file <路径>   回滚所用备份文件，默认取最新
  -k, --keep <N>      备份保留份数，默认 14
  -h, --help          显示本帮助
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    up | down | status | import | backup | restore | reset | shell) ACTION="$1"; shift ;;
    -s | --site) SITE="${2:?--site 需要取值}"; shift 2 ;;
    -f | --file) FILE="${2:?--file 需要取值}"; shift 2 ;;
    -k | --keep) KEEP="${2:?--keep 需要取值}"; shift 2 ;;
    -h | --help) usage; exit 0 ;;
    *)
      echo "未知参数：$1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE" "$@"
  else
    docker-compose -f "$COMPOSE" "$@"
  fi
}

cenv() {
  local key="$1" fallback="$2" line
  line="$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$CONTAINER" 2>/dev/null | grep -m1 "^${key}=" || true)"
  if [ -z "$line" ]; then
    printf '%s' "$fallback"
  else
    printf '%s' "${line#*=}"
  fi
}

db_name() { cenv MYSQL_DATABASE nav; }
root_pwd() { cenv MYSQL_ROOT_PASSWORD nav_root_pwd; }

wait_healthy() {
  local i status
  for i in $(seq 1 60); do
    status="$(docker inspect -f '{{.State.Health.Status}}' "$CONTAINER" 2>/dev/null || true)"
    [ "$status" = "healthy" ] && return 0
    sleep 2
  done
  echo "容器未在 120 秒内变为 healthy，请执行 docker logs $CONTAINER 查看原因" >&2
  exit 1
}

new_backup() {
  local tag="$1" stamp
  stamp="$(date +%Y%m%d-%H%M%S)"
  if [ -n "$tag" ]; then
    stamp="${tag}-${stamp}"
  fi
  docker exec "$CONTAINER" sh /tools/backup.sh "$stamp" || {
    echo "备份失败：$tag" >&2
    exit 1
  }
}

invoke_sql() {
  local sql="$1" rootPwd
  rootPwd="$(root_pwd)"
  docker exec -e "MYSQL_PWD=$rootPwd" "$CONTAINER" mysql -uroot -N -B -e "$sql" || {
    echo "SQL 执行失败：$sql" >&2
    exit 1
  }
}

invoke_sql_file() {
  local path="$1" rootPwd name
  [ -f "$path" ] || {
    echo "文件不存在：$path" >&2
    exit 1
  }
  rootPwd="$(root_pwd)"
  name="/tmp/import-$(date +%s)-$$.sql"
  docker cp "$path" "${CONTAINER}:${name}" || {
    echo "拷贝失败：$path" >&2
    exit 1
  }
  if ! docker exec -e "MYSQL_PWD=$rootPwd" "$CONTAINER" sh -c "mysql -uroot < '$name'"; then
    docker exec "$CONTAINER" rm -f "$name" >/dev/null 2>&1 || true
    echo "导入失败：$path" >&2
    exit 1
  fi
  docker exec "$CONTAINER" rm -f "$name" >/dev/null 2>&1 || true
}

case "$ACTION" in
  up)
    mkdir -p "$DATA_DIR" "$BACKUP_DIR"
    compose up -d
    wait_healthy
    echo "已启动：127.0.0.1:$(cenv MYSQL_PORT 3307)"
    ;;
  down)
    compose down
    echo "已停止（docker/data/mysql 数据保留）"
    ;;
  status)
    db="$(db_name)"
    tables="$(invoke_sql "SELECT table_name FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE' ORDER BY table_name")"
    if [ -z "$tables" ]; then
      echo "库内暂无表"
    else
      query=""
      while IFS= read -r tbl; do
        [ -n "$tbl" ] || continue
        [ -n "$query" ] && query="$query UNION ALL "
        query="$query SELECT '$tbl' AS tbl, COUNT(*) AS cnt FROM \`$db\`.\`$tbl\`"
      done <<<"$tables"
      invoke_sql "$query"
    fi
    ;;
  import)
    db="$(db_name)"
    node "$ROOT/src/export-db.js" --site "$SITE" --target mysql --db "$db" || {
      echo "SQL 生成失败" >&2
      exit 1
    }
    existing="$(invoke_sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db'")"
    if [ "$existing" -gt 0 ]; then
      echo "库内已有表，先做导入前备份"
      new_backup pre-import
    fi
    invoke_sql_file "$ROOT/output/$SITE/db/mysql/schema.sql"
    invoke_sql_file "$ROOT/output/$SITE/db/mysql/data.sql"
    echo "导入完成：$db"
    ;;
  backup)
    new_backup ""
    ;;
  restore)
    if [ -n "$FILE" ]; then
      case "$FILE" in
        /*) target="$FILE" ;;
        *) target="$ROOT/$FILE" ;;
      esac
    else
      target="$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | head -n 1 || true)"
    fi
    [ -n "$target" ] || {
      echo "没有可用备份" >&2
      exit 1
    }
    [ -f "$target" ] || {
      echo "备份不存在：$target" >&2
      exit 1
    }
    echo "回滚前先备份当前状态"
    new_backup pre-restore
    docker exec "$CONTAINER" sh /tools/restore.sh "/backup/$(basename "$target")" || {
      echo "回滚失败，可再用 pre-restore 备份恢复" >&2
      exit 1
    }
    ;;
  reset)
    compose down
    stamp="$(date +%Y%m%d-%H%M%S)"
    if [ -d "$DATA_DIR" ]; then
      mv "$DATA_DIR" "$DATA_DIR.bak-$stamp"
      echo "数据目录已移至 $DATA_DIR.bak-$stamp（未删除，可回退）"
    else
      echo "数据目录不存在，无需重置"
    fi
    ;;
  shell)
    docker exec -it "$CONTAINER" sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
    ;;
esac

if [ -d "$BACKUP_DIR" ]; then
  stale="$(ls -1t "$BACKUP_DIR"/*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))" || true)"
  if [ -n "$stale" ]; then
    printf '%s\n' "$stale" | while IFS= read -r old; do
      [ -n "$old" ] && rm -f "$old"
    done
  fi
fi