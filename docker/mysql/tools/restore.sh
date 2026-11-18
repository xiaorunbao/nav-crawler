#!/bin/sh
set -eu
src="${1:?用法: restore.sh <备份文件>}"
db="${MYSQL_DATABASE:-nav}"
case "$db" in
  *[!A-Za-z0-9_]*) echo "非法库名：$db" >&2; exit 1 ;;
esac
[ -f "$src" ] || { echo "备份不存在：$src" >&2; exit 1; }
gzip -t "$src" || { echo "备份文件损坏：$src" >&2; exit 1; }
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?缺少 MYSQL_ROOT_PASSWORD}"

mysql -uroot -e "DROP DATABASE IF EXISTS \`$db\`; CREATE DATABASE \`$db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;"
gunzip -c "$src" | mysql -uroot

echo "已回滚至 $(basename "$src")"