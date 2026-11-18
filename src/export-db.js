#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { normalizeUrl } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['csv', 'mysql', 'mongo', 'all'];

const TABLES = [
  {
    name: 'nav_site',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'siteName', type: 'varchar', size: 255 },
      { name: 'entry', type: 'varchar', size: 1024 },
      { name: 'note', type: 'text' },
      { name: 'generatedAt', type: 'datetime' },
      { name: 'structureOnly', type: 'int' },
      { name: 'pages', type: 'int' },
      { name: 'rawLinks', type: 'int' },
      { name: 'validLinks', type: 'int' },
      { name: 'uniqueLinks', type: 'int' },
      { name: 'filteredLinks', type: 'int' },
      { name: 'excludedLinks', type: 'int' },
      { name: 'newLinks', type: 'int' },
      { name: 'totalCategories', type: 'int' },
      { name: 'totalSubCategories', type: 'int' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_page',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'url', type: 'varchar', size: 1024 },
      { name: 'urlKey', type: 'varchar', size: 1024 },
      { name: 'label', type: 'varchar', size: 255 },
      { name: 'labels', type: 'text' },
      { name: 'sidebar', type: 'int' },
      { name: 'categories', type: 'int' },
      { name: 'links', type: 'int' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_category',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'name', type: 'varchar', size: 255 },
      { name: 'pageLabels', type: 'text' },
      { name: 'linkCount', type: 'int' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_sub_category',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'categoryId', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'categoryName', type: 'varchar', size: 255 },
      { name: 'name', type: 'varchar', size: 255 },
      { name: 'linkCount', type: 'int' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_link',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'categoryId', type: 'varchar', size: 32 },
      { name: 'categoryName', type: 'varchar', size: 255 },
      { name: 'subCategoryId', type: 'varchar', size: 32 },
      { name: 'subCategoryName', type: 'varchar', size: 255 },
      { name: 'name', type: 'varchar', size: 512 },
      { name: 'url', type: 'varchar', size: 1024 },
      { name: 'urlKey', type: 'varchar', size: 1024 },
      { name: 'description', type: 'text' },
      { name: 'isNew', type: 'int' },
      { name: 'firstSeen', type: 'datetime' },
      { name: 'lastSeen', type: 'datetime' },
      { name: 'dupElsewhere', type: 'int' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_crawl_state',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'url', type: 'varchar', size: 1024 },
      { name: 'urlKey', type: 'varchar', size: 1024 },
      { name: 'name', type: 'varchar', size: 512 },
      { name: 'category', type: 'varchar', size: 255 },
      { name: 'subCategory', type: 'varchar', size: 255 },
      { name: 'firstSeen', type: 'datetime' },
      { name: 'lastSeen', type: 'datetime' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_risk_summary',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'categoryName', type: 'varchar', size: 255 },
      { name: 'pageLabels', type: 'text' },
      { name: 'links', type: 'int' },
      { name: 'adult', type: 'int' },
      { name: 'piracy', type: 'int' },
      { name: 'gambling', type: 'int' },
      { name: 'ratio', type: 'decimal' },
      { name: 'level', type: 'varchar', size: 16 },
      { name: 'signals', type: 'text' },
      { name: 'emptied', type: 'int' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_filter_summary',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'reason', type: 'text' },
      { name: 'count', type: 'int' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_excluded_category',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'name', type: 'varchar', size: 255 },
      { name: 'links', type: 'int' },
      { name: 'reason', type: 'text' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
  {
    name: 'nav_rejected',
    columns: [
      { name: 'id', type: 'varchar', size: 32 },
      { name: 'siteKey', type: 'varchar', size: 64 },
      { name: 'category', type: 'varchar', size: 255 },
      { name: 'subCategory', type: 'varchar', size: 255 },
      { name: 'name', type: 'varchar', size: 512 },
      { name: 'url', type: 'varchar', size: 1024 },
      { name: 'urlKey', type: 'varchar', size: 1024 },
      { name: 'description', type: 'text' },
      { name: 'reason', type: 'text' },
      { name: 'createTime', type: 'datetime' },
      { name: 'createBy', type: 'varchar', size: 64 },
      { name: 'updateTime', type: 'datetime' },
      { name: 'updateBy', type: 'varchar', size: 64 },
      { name: 'yn', type: 'int' },
    ],
  },
];

function parseArgs(argv) {
  const args = {
    site: 'all',
    out: path.join(ROOT, 'output'),
    target: 'csv',
    db: 'nav',
    operator: 'nav-crawler',
    now: null,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => argv[i + 1];
    if (a === '--site') args.site = val(), i += 1;
    else if (a.startsWith('--site=')) args.site = a.slice(7);
    else if (a === '--out') args.out = path.resolve(val()), i += 1;
    else if (a === '--target') args.target = val(), i += 1;
    else if (a === '--db') args.db = val(), i += 1;
    else if (a === '--operator') args.operator = val(), i += 1;
    else if (a === '--now') args.now = val(), i += 1;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`用法：node src/export-db.js [选项]

  --site <名称|all>      指定站点，默认 all（扫描 output 下含 links.json 的目录）
  --out <目录>           产物根目录，默认 output
  --target <目标>        csv | mysql | mongo | all，默认 csv
  --db <库名>            MySQL 库名，默认 nav
  --operator <标识>      createBy / updateBy 取值，默认 nav-crawler
  --now <ISO时间>        缺失时间字段的兜底时间，默认当前时间
  --help, -h             显示本帮助

输出位置：
  output/<站点>/db/csv/*.csv
  output/<站点>/db/mysql/schema.sql + data.sql
  output/<站点>/db/mongo/*.ndjson（供 mongoimport 使用）`);
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`读取失败 ${file}: ${err.message}`);
  }
}

async function listSites(outDir) {
  let entries;
  try {
    entries = await readdir(outDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const sites = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      await access(path.join(outDir, entry.name, 'links.json'));
      sites.push(entry.name);
    } catch {
      continue;
    }
  }
  return sites;
}

function hashId(...parts) {
  return createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 16);
}

function isoOr(value, fallback) {
  return value || fallback;
}

function joinList(list, sep = '|') {
  return Array.isArray(list) && list.length ? list.join(sep) : '';
}

function audit(operator, createTime, updateTime, yn = 1) {
  return { createTime, createBy: operator, updateTime: updateTime ?? createTime, updateBy: operator, yn };
}

function buildRows({ siteKey, links, siteState, rejected, operator, fallbackNow }) {
  const meta = links.meta ?? {};
  const stats = links.stats ?? {};
  const generatedAt = isoOr(meta.generatedAt, fallbackNow);
  const base = audit(operator, generatedAt, generatedAt, 1);
  const rows = Object.fromEntries(TABLES.map((t) => [t.name, []]));

  rows.nav_site.push({
    id: hashId(siteKey, 'site'),
    siteKey,
    siteName: meta.site ?? siteKey,
    entry: meta.entry ?? '',
    note: meta.note ?? '',
    generatedAt,
    structureOnly: meta.structureOnly ? 1 : 0,
    pages: stats.pages ?? 0,
    rawLinks: stats.rawLinks ?? 0,
    validLinks: stats.validLinks ?? 0,
    uniqueLinks: stats.uniqueLinks ?? 0,
    filteredLinks: stats.filteredLinks ?? 0,
    excludedLinks: stats.excludedLinks ?? 0,
    newLinks: stats.newLinks ?? 0,
    totalCategories: stats.totalCategories ?? 0,
    totalSubCategories: stats.totalSubCategories ?? 0,
    ...base,
  });

  for (const page of links.navPages ?? []) {
    rows.nav_page.push({
      id: hashId(siteKey, 'page', page.url),
      siteKey,
      url: page.url ?? '',
      urlKey: page.url ? normalizeUrl(page.url) : '',
      label: page.label ?? '',
      labels: joinList(page.labels),
      sidebar: page.sidebar ? 1 : 0,
      categories: page.categories ?? 0,
      links: page.links ?? 0,
      ...base,
    });
  }

  const activeKeys = new Set();

  for (const cat of links.categories ?? []) {
    const categoryId = hashId(siteKey, 'cat', cat.name);
    const catLinks = cat.subCategories.reduce((sum, sub) => sum + (sub.links?.length ?? 0), 0);
    rows.nav_category.push({
      id: categoryId,
      siteKey,
      name: cat.name,
      pageLabels: joinList(cat.pageLabels),
      linkCount: cat.linkCount ?? catLinks,
      ...base,
    });

    for (const sub of cat.subCategories ?? []) {
      const subCategoryId = hashId(siteKey, 'sub', cat.name, sub.name);
      rows.nav_sub_category.push({
        id: subCategoryId,
        categoryId,
        siteKey,
        categoryName: cat.name,
        name: sub.name,
        linkCount: sub.linkCount ?? sub.links?.length ?? 0,
        ...base,
      });

      for (const link of sub.links ?? []) {
        const urlKey = normalizeUrl(link.url);
        activeKeys.add(urlKey);
        const state = siteState[urlKey];
        const firstSeen = isoOr(link.firstSeen, generatedAt);
        const lastSeen = isoOr(state?.lastSeen, isoOr(link.firstSeen, generatedAt));
        rows.nav_link.push({
          id: hashId(siteKey, 'link', cat.name, sub.name, urlKey),
          siteKey,
          categoryId,
          categoryName: cat.name,
          subCategoryId,
          subCategoryName: sub.name,
          name: link.name ?? '',
          url: link.url ?? '',
          urlKey,
          description: link.desc ?? '',
          isNew: link.isNew ? 1 : 0,
          firstSeen,
          lastSeen,
          dupElsewhere: link.dupElsewhere ? 1 : 0,
          ...audit(operator, firstSeen, lastSeen, 1),
        });
      }
    }
  }

  for (const [urlKey, record] of Object.entries(siteState)) {
    const firstSeen = isoOr(record.firstSeen, generatedAt);
    const lastSeen = isoOr(record.lastSeen, firstSeen);
    const active = activeKeys.has(urlKey);
    rows.nav_crawl_state.push({
      id: hashId(siteKey, 'state', urlKey),
      siteKey,
      url: urlKey,
      urlKey,
      name: record.name ?? '',
      category: record.category ?? '',
      subCategory: record.subCategory ?? '',
      firstSeen,
      lastSeen,
      ...audit(operator, firstSeen, lastSeen, active ? 1 : 0),
    });
  }

  for (const risk of links.riskSummary ?? []) {
    const signals = (risk.signals ?? []).map((s) => `${s.reason} × ${s.count}`).join('、');
    rows.nav_risk_summary.push({
      id: hashId(siteKey, 'risk', risk.name),
      siteKey,
      categoryName: risk.name,
      pageLabels: joinList(risk.pageLabels),
      links: risk.links ?? 0,
      adult: risk.adult ?? 0,
      piracy: risk.piracy ?? 0,
      gambling: risk.gambling ?? 0,
      ratio: risk.ratio ?? 0,
      level: risk.level ?? '',
      signals,
      emptied: risk.emptied ? 1 : 0,
      ...base,
    });
  }

  for (const item of links.filterSummary ?? []) {
    rows.nav_filter_summary.push({
      id: hashId(siteKey, 'filter', item.reason),
      siteKey,
      reason: item.reason ?? '',
      count: item.count ?? 0,
      ...base,
    });
  }

  for (const item of links.excludedCategories ?? []) {
    rows.nav_excluded_category.push({
      id: hashId(siteKey, 'excluded', item.name),
      siteKey,
      name: item.name ?? '',
      links: item.links ?? 0,
      reason: item.reason ?? '',
      ...audit(operator, generatedAt, generatedAt, 0),
    });
  }

  const rejectedAt = isoOr(rejected?.generatedAt, generatedAt);
  for (const item of rejected?.items ?? []) {
    const urlKey = item.url ? normalizeUrl(item.url) : '';
    rows.nav_rejected.push({
      id: hashId(siteKey, 'rejected', item.category, item.subCategory, urlKey),
      siteKey,
      category: item.category ?? '',
      subCategory: item.subCategory ?? '',
      name: item.name ?? '',
      url: item.url ?? '',
      urlKey,
      description: item.desc ?? '',
      reason: item.reason ?? '',
      ...audit(operator, rejectedAt, rejectedAt, 0),
    });
  }

  return rows;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvText(columns, rows) {
  const header = columns.map((c) => c.name).join(',');
  const body = rows.map((row) => columns.map((c) => csvCell(row[c.name])).join(','));
  return `\uFEFF${[header, ...body].join('\r\n')}\r\n`;
}

function mysqlType(col) {
  if (col.type === 'varchar') return `VARCHAR(${col.size ?? 255})`;
  if (col.type === 'text') return 'TEXT';
  if (col.type === 'int') return 'INT';
  if (col.type === 'decimal') return 'DECIMAL(6,4)';
  if (col.type === 'datetime') return 'DATETIME';
  return 'VARCHAR(255)';
}

function mysqlSchema(table) {
  const cols = table.columns.map((col) => {
    if (col.name === 'id') return `  \`id\` ${mysqlType(col)} NOT NULL`;
    return `  \`${col.name}\` ${mysqlType(col)}`;
  });
  const indexes = [];
  if (table.columns.some((c) => c.name === 'siteKey')) indexes.push(`  KEY \`idx_${table.name}_site\` (\`siteKey\`)`);
  if (table.columns.some((c) => c.name === 'categoryId')) {
    indexes.push(`  KEY \`idx_${table.name}_category\` (\`categoryId\`)`);
  }
  if (table.columns.some((c) => c.name === 'subCategoryId')) {
    indexes.push(`  KEY \`idx_${table.name}_sub_category\` (\`subCategoryId\`)`);
  }
  return [
    `CREATE TABLE IF NOT EXISTS \`${table.name}\` (`,
    [...cols, `  PRIMARY KEY (\`id\`)`, ...indexes].join(',\n'),
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;',
  ].join('\n');
}

function toMysqlDatetime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function mysqlLiteral(value, col) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (col.type === 'datetime') {
    const dt = toMysqlDatetime(value);
    return dt === null ? 'NULL' : `'${dt}'`;
  }
  return `'${String(value).replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
}

function mysqlData(table, rows) {
  if (!rows.length) return '';
  const cols = table.columns;
  const colList = cols.map((c) => `\`${c.name}\``).join(', ');
  const updateCols = cols.filter((c) => !['id', 'createTime', 'createBy'].includes(c.name));
  const updates = updateCols.map((c) => `\`${c.name}\` = VALUES(\`${c.name}\`)`).join(', ');
  const lines = rows.map((row) => {
    const values = cols.map((c) => mysqlLiteral(row[c.name], c)).join(', ');
    const tail = updates ? ` ON DUPLICATE KEY UPDATE ${updates}` : '';
    return `INSERT INTO \`${table.name}\` (${colList}) VALUES (${values})${tail};`;
  });
  return `${lines.join('\n')}\n`;
}

function mongoDoc(columns, row) {
  const doc = { _id: row.id };
  for (const col of columns) {
    if (col.name === 'id') continue;
    const value = row[col.name];
    if (value === undefined || value === null) continue;
    doc[col.name] = col.type === 'datetime' ? { $date: value } : value;
  }
  return doc;
}

async function writeCsv(dir, rows) {
  await mkdir(dir, { recursive: true });
  const files = [];
  for (const table of TABLES) {
    const file = path.join(dir, `${table.name}.csv`);
    await writeFile(file, csvText(table.columns, rows[table.name]), 'utf8');
    files.push(file);
  }
  return files;
}

async function writeMysql(dir, rows, db) {
  await mkdir(dir, { recursive: true });
  const schema = [
    `CREATE DATABASE IF NOT EXISTS \`${db}\` DEFAULT CHARSET utf8mb4;`,
    `USE \`${db}\`;`,
    '',
    TABLES.map(mysqlSchema).join('\n\n'),
    '',
  ].join('\n');
  const data = [
    `USE \`${db}\`;`,
    'START TRANSACTION;',
    '',
    TABLES.map((t) => mysqlData(t, rows[t.name])).join('\n'),
    'COMMIT;',
    '',
  ].join('\n');
  const schemaFile = path.join(dir, 'schema.sql');
  const dataFile = path.join(dir, 'data.sql');
  await writeFile(schemaFile, schema, 'utf8');
  await writeFile(dataFile, data, 'utf8');
  return [schemaFile, dataFile];
}

async function writeMongo(dir, rows) {
  await mkdir(dir, { recursive: true });
  const files = [];
  for (const table of TABLES) {
    const file = path.join(dir, `${table.name}.ndjson`);
    const lines = rows[table.name].map((row) => JSON.stringify(mongoDoc(table.columns, row)));
    await writeFile(file, lines.length ? `${lines.join('\n')}\n` : '', 'utf8');
    files.push(file);
  }
  return files;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }
  if (!TARGETS.includes(opts.target)) {
    console.error(`不支持的目标：${opts.target}；可选 ${TARGETS.join(' / ')}`);
    process.exitCode = 1;
    return;
  }
  if (!/^[A-Za-z0-9_$]+$/.test(opts.db)) {
    console.error(`非法库名：${opts.db}；仅允许字母、数字、下划线、美元符号`);
    process.exitCode = 1;
    return;
  }

  const fallbackNow = opts.now ? new Date(opts.now).toISOString() : new Date().toISOString();
  const sites = opts.site === 'all' ? await listSites(opts.out) : [opts.site];
  if (!sites.length) {
    console.error(`未在 ${opts.out} 下找到含 links.json 的站点目录。`);
    process.exitCode = 1;
    return;
  }

  const state = (await readJson(path.join(opts.out, 'state.json'), { sites: {} }))?.sites ?? {};
  const targets = opts.target === 'all' ? ['csv', 'mysql', 'mongo'] : [opts.target];

  for (const siteKey of sites) {
    const siteDir = path.join(opts.out, siteKey);
    const links = await readJson(path.join(siteDir, 'links.json'));
    if (!links) {
      console.error(`跳过 ${siteKey}：缺少 links.json`);
      continue;
    }
    const rejected = await readJson(path.join(siteDir, 'rejected.json'), null);
    const rows = buildRows({
      siteKey,
      links,
      siteState: state[siteKey] ?? {},
      rejected,
      operator: opts.operator,
      fallbackNow,
    });

    console.log(`\n=== ${siteKey} ===`);
    for (const table of TABLES) {
      console.log(`  ${table.name}: ${rows[table.name].length} 行`);
    }

    for (const target of targets) {
      if (target === 'csv') {
        const files = await writeCsv(path.join(siteDir, 'db', 'csv'), rows);
        console.log(`  CSV   : ${files[0].replace(`${opts.out}${path.sep}`, '')} 等 ${files.length} 个文件`);
      } else if (target === 'mysql') {
        const files = await writeMysql(path.join(siteDir, 'db', 'mysql'), rows, opts.db);
        console.log(`  MySQL : ${files.map((f) => f.replace(`${opts.out}${path.sep}`, '')).join(' / ')}`);
      } else {
        const files = await writeMongo(path.join(siteDir, 'db', 'mongo'), rows);
        console.log(`  Mongo : ${files[0].replace(`${opts.out}${path.sep}`, '')} 等 ${files.length} 个文件`);
      }
    }
  }

  console.log('\n完成。');
}

main().catch((err) => {
  console.error(`运行失败：${err.stack || err.message}`);
  process.exitCode = 1;
});