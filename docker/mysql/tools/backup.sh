#!/bin/sh
set -eu
stamp="${1:?用法: backup.sh <stamp>}"
db="${MYSQL_DATABASE:-nav}"
mkdir -p /backup
out="/backup/${db}-${stamp}.sql.gz"
export MYSQL_PWD="${MYSQL_ROOT_PASSWORD:?缺少 MYSQL_ROOT_PASSWORD}"

mysqldump -uroot \
  --single-transaction \
  --quick \
  --routines \
  --triggers \
  --events \
  --set-gtid-purged=OFF \
  --databases "$db" | gzip -9 > "$out"

if ! gzip -t "$out"; then
  echo "备份文件损坏：$out" >&2
  rm -f "$out"
  exit 1
fi

if ! gunzip -c "$out" | tail -n 5 | grep -q 'Dump completed'; then
  echo "备份内容不完整：$out" >&2
  rm -f "$out"
  exit 1
fi

ls -lh "$out"