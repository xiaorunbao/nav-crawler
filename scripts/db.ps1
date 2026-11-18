param(
  [ValidateSet('up', 'down', 'status', 'import', 'backup', 'restore', 'reset', 'shell')]
  [string]$Action = 'status',
  [string]$Site = 'jubt5',
  [string]$File = '',
  [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$Root      = Split-Path -Parent $PSScriptRoot
$Compose   = Join-Path $Root 'compose.yaml'
$Container = 'nav-mysql'
$BackupDir = Join-Path $Root 'docker\backup'
$DataDir   = Join-Path $Root 'docker\data\mysql'

function Get-CEnv([string]$key, [string]$default) {
  $line = docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' $Container 2>$null |
          Where-Object { $_ -like "$key=*" } | Select-Object -First 1
  if (-not $line) { return $default }
  return $line.Substring($key.Length + 1)
}

function Wait-Healthy {
  for ($i = 0; $i -lt 60; $i++) {
    $s = docker inspect -f '{{.State.Health.Status}}' $Container 2>$null
    if ($s -eq 'healthy') { return }
    Start-Sleep -Seconds 2
  }
  throw '容器未在 120 秒内变为 healthy，请执行 docker logs nav-mysql 查看原因'
}

function Get-DbName { Get-CEnv 'MYSQL_DATABASE' 'nav' }

function New-Backup([string]$tag) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if ($tag) { $stamp = "$tag-$stamp" }
  docker exec $Container sh /tools/backup.sh $stamp
  if ($LASTEXITCODE -ne 0) { throw "备份失败：$tag" }
}

function Get-RootPwd { Get-CEnv 'MYSQL_ROOT_PASSWORD' 'nav_root_pwd' }

function Invoke-SqlFile([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { throw "文件不存在：$path" }
  $rootPwd = Get-RootPwd
  $name = "/tmp/import-$([Guid]::NewGuid().ToString('N')).sql"
  docker cp $path "${Container}:${name}"
  if ($LASTEXITCODE -ne 0) { throw "拷贝失败：$path" }
  docker exec -e "MYSQL_PWD=$rootPwd" $Container sh -c "mysql -uroot < '$name'"
  $code = $LASTEXITCODE
  docker exec $Container rm -f $name | Out-Null
  if ($code -ne 0) { throw "导入失败：$path" }
}

function Invoke-Sql([string]$sql) {
  $rootPwd = Get-RootPwd
  docker exec -e "MYSQL_PWD=$rootPwd" $Container mysql -uroot -N -B -e $sql
  if ($LASTEXITCODE -ne 0) { throw "SQL 执行失败：$sql" }
}

switch ($Action) {
  'up' {
    New-Item -ItemType Directory -Force -Path $DataDir, $BackupDir | Out-Null
    docker compose -f $Compose up -d
    if ($LASTEXITCODE -ne 0) { throw 'compose up 失败' }
    Wait-Healthy
    "已启动：127.0.0.1:$(Get-CEnv 'MYSQL_PORT' '3307')"
  }
  'down' {
    docker compose -f $Compose down
    '已停止（docker\data\mysql 数据保留）'
  }
  'status' {
    $db = Get-DbName
    $bt = [char]96
    $names = @(Invoke-Sql "SELECT table_name FROM information_schema.tables WHERE table_schema='$db' AND table_type='BASE TABLE' ORDER BY table_name")
    if ($names.Count -eq 0) { '库内暂无表'; break }
    $q = ($names | ForEach-Object { "SELECT '$($_)' AS tbl, COUNT(*) AS cnt FROM $bt$db$bt.$bt$_$bt" }) -join ' UNION ALL '
    Invoke-Sql $q
  }
  'import' {
    $db = Get-DbName
    node (Join-Path $Root 'src\export-db.js') --site $Site --target mysql --db $db
    if ($LASTEXITCODE -ne 0) { throw 'SQL 生成失败' }
    $existing = [int](Invoke-Sql "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$db'")
    if ($existing -gt 0) {
      '库内已有表，先做导入前备份'
      New-Backup 'pre-import'
    }
    Invoke-SqlFile (Join-Path $Root "output\$Site\db\mysql\schema.sql")
    Invoke-SqlFile (Join-Path $Root "output\$Site\db\mysql\data.sql")
    "导入完成：$db"
  }
  'backup' { New-Backup '' }
  'restore' {
    $target = if ($File) {
      if ([IO.Path]::IsPathRooted($File)) { $File } else { Join-Path $Root $File }
    } else {
      $latest = Get-ChildItem $BackupDir -Filter '*.sql.gz' -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 1
      if ($latest) { $latest.FullName }
    }
    if (-not $target) { throw '没有可用备份' }
    '回滚前先备份当前状态'
    New-Backup 'pre-restore'
    $rel = "/backup/$([IO.Path]::GetFileName($target))"
    docker exec $Container sh /tools/restore.sh $rel
    if ($LASTEXITCODE -ne 0) { throw '回滚失败，可再用 pre-restore 备份恢复' }
  }
  'reset' {
    docker compose -f $Compose down
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    if (Test-Path $DataDir) {
      $old = "$DataDir.bak-$stamp"
      Move-Item -LiteralPath $DataDir -Destination $old
      "数据目录已移至 $old（未删除，可回退）"
    } else {
      '数据目录不存在，无需重置'
    }
  }
  'shell' {
    docker exec -it $Container sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" "$MYSQL_DATABASE"'
  }
}

if (Test-Path $BackupDir) {
  Get-ChildItem $BackupDir -Filter '*.sql.gz' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    Remove-Item -Force -ErrorAction SilentlyContinue
}