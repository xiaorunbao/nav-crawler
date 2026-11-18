#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import { crawlSite } from './crawl.js';
import { createFilter } from './filter.js';
import { assessCategories, DEFAULT_RISK_RULES } from './risk.js';
import { buildJson, buildMarkdown } from './export.js';
import { loadState, saveState, applyState } from './state.js';
import { normalizeUrl } from './util.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    site: 'all',
    config: path.join(ROOT, 'config', 'sites.json'),
    blocklist: path.join(ROOT, 'config', 'blocklist.json'),
    out: path.join(ROOT, 'output'),
    deep: true,
    delayMs: null,
    maxPages: null,
    list: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const val = () => argv[i + 1];
    if (a === '--site') args.site = val(), i += 1;
    else if (a.startsWith('--site=')) args.site = a.slice(7);
    else if (a === '--config') args.config = path.resolve(val()), i += 1;
    else if (a === '--out') args.out = path.resolve(val()), i += 1;
    else if (a === '--delay') args.delayMs = Number(val()), i += 1;
    else if (a === '--max-pages') args.maxPages = Number(val()), i += 1;
    else if (a === '--no-deep') args.deep = false;
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.list = true;
  }
  return args;
}

async function readJson(file, fallback = {}) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`配置文件解析失败 ${file}: ${err.message}`);
  }
}

/** 站点可声明 excludeCategories，整块分类按策略排除（只记数量，不落地条目） */
function dropExcludedCategories(categories, tokens) {
  if (!tokens?.length) return { categories, excluded: [] };
  const excluded = [];
  const kept = [];
  for (const cat of categories) {
    const hit = tokens.find((t) => cat.name.includes(t));
    if (hit) {
      excluded.push({
        name: cat.name,
        links: cat.subCategories.reduce((sum, sub) => sum + sub.links.length, 0),
        reason: `分类排除：${hit}`,
      });
      continue;
    }
    kept.push(cat);
  }
  return { categories: kept, excluded };
}

/** 只保留分类骨架与数量，用于校验选择器/解析结果而不落地具体条目 */
function toStructureOnly(categories) {
  return categories.map((cat) => ({
    name: cat.name,
    pageLabels: cat.pageLabels ?? [],
    linkCount: cat.subCategories.reduce((sum, sub) => sum + sub.links.length, 0),
    subCategories: cat.subCategories.map((sub) => ({ name: sub.name, linkCount: sub.links.length, links: [] })),
  }));
}

/** 过滤 + 去重：同一子类内去重，跨类保留（导航体系里同一工具可归属多个垂直领域） */
function filterAndDedupe(categories, filter) {
  const seenGlobal = new Set();
  const rejected = [];
  const summary = new Map();

  const out = [];
  for (const cat of categories) {
    const keptCat = { name: cat.name, pageLabels: cat.pageLabels ?? [], subCategories: [] };
    for (const sub of cat.subCategories) {
      const seenLocal = new Set();
      const keptLinks = [];
      for (const link of sub.links) {
        const verdict = filter.evaluate({
          name: link.name,
          desc: link.desc,
          url: link.url,
          category: cat.name,
          subCategory: sub.name,
        });
        if (verdict.blocked) {
          rejected.push({ ...link, category: cat.name, subCategory: sub.name, reason: verdict.reason });
          const key = `${cat.name} / ${sub.name} / ${verdict.reason}`;
          summary.set(key, (summary.get(key) ?? 0) + 1);
          continue;
        }
        const key = normalizeUrl(link.url);
        if (seenLocal.has(key)) continue;
        seenLocal.add(key);
        if (seenGlobal.has(key)) link.dupElsewhere = true;
        else seenGlobal.add(key);
        keptLinks.push(link);
      }
      if (keptLinks.length) keptCat.subCategories.push({ ...sub, links: keptLinks });
    }
    if (keptCat.subCategories.length) out.push(keptCat);
  }

  return { categories: out, rejected, summary, uniqueLinks: seenGlobal.size };
}

function printSiteSummary(result) {
  const { site, stats } = result;
  console.log(`\n=== ${site.name} ===`);
  const tail = stats.firstRun ? `基线 ${stats.uniqueLinks} 个唯一链接` : `本次新增 ${stats.newLinks} 条`;
  console.log(`页面 ${stats.pages} 个｜原始链接 ${stats.rawLinks} 条｜有效 ${stats.validLinks} 条（去重后 ${stats.uniqueLinks} 个唯一链接）｜过滤 ${stats.filteredLinks} 条｜${tail}`);
  for (const [reason, count] of result.filterSummary.entries()) {
    console.log(`  过滤：${reason} × ${count}`);
  }
  if (result.riskSummary?.length) {
    const levels = ['clean', 'low', 'medium', 'high'];
    const counts = levels.map((lv) => `${lv} ${result.riskSummary.filter((r) => r.level === lv).length}`).join(' / ');
    console.log(`  合规度：${counts}`);
    const clean = result.riskSummary.filter((r) => r.level === 'clean').sort((a, b) => b.links - a.links);
    if (clean.length) console.log(`  可收录候选：${clean.slice(0, 8).map((r) => `${r.name}(${r.links})`).join('、')}${clean.length > 8 ? ` 等 ${clean.length} 个` : ''}`);
  }
  console.log(`  Markdown: ${result.files.md}`);
  console.log(`  JSON    : ${result.files.json}`);
}

const ADAPTER_NAME = /^[a-z0-9_-]+$/i;

/** 站点可声明 adapter，走专用解析器；否则用通用解析器 */
async function loadCrawler(site) {
  if (!site.adapter) return crawlSite;
  if (!ADAPTER_NAME.test(site.adapter)) throw new Error(`非法 adapter 名称：${site.adapter}`);
  const mod = await import(new URL(`./adapters/${site.adapter}.js`, import.meta.url));
  if (typeof mod.crawl !== 'function') throw new Error(`adapter ${site.adapter} 没有导出 crawl()`);
  return mod.crawl;
}

async function runSite(site, opts, { defaults, blocklist, state, filter }) {
  const crawlFn = await loadCrawler(site);
  const result = await crawlFn(site, defaults, {
    rootDir: ROOT,
    deep: opts.deep,
    delayMs: opts.delayMs ?? undefined,
    maxPages: opts.maxPages ?? undefined,
  });

  const dropped = dropExcludedCategories(result.categories, site.excludeCategories);
  const riskRules = { ...DEFAULT_RISK_RULES, ...(blocklist.risk ?? {}) };
  const riskSummary = assessCategories(dropped.categories, { filter, rules: riskRules });
  const filtered = filterAndDedupe(dropped.categories, filter);
  const structureOnly = site.structureOnly === true;
  const outputCategories = structureOnly ? toStructureOnly(filtered.categories) : filtered.categories;

  // 过滤后整类清空的分类在分类目录里不存在，但仍是有效的风险画像，标注出来避免困惑
  const finalNames = new Set(outputCategories.map((c) => c.name));
  for (const item of riskSummary) item.emptied = !finalNames.has(item.name);

  const hadState = Boolean(state.sites[site.name]);
  const nowIso = new Date().toISOString();
  // 结构快照模式不落地条目，也不写状态库，避免把未落地的链接名/地址持久化
  const newCount = structureOnly
    ? 0
    : applyState(filtered.categories, (state.sites[site.name] ??= {}), nowIso, { markNew: hadState }).newCount;

  const stats = {
    pages: result.stats.pages,
    rawLinks: result.stats.rawLinks,
    validLinks: filtered.categories.reduce(
      (sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.links.length, 0),
      0,
    ),
    filteredLinks: filtered.rejected.length,
    excludedLinks: dropped.excluded.reduce((sum, item) => sum + item.links, 0),
    newLinks: newCount,
    uniqueLinks: filtered.uniqueLinks,
    firstRun: !hadState,
    structureOnly,
  };

  const outDir = path.join(opts.out, site.name);
  await mkdir(outDir, { recursive: true });
  const filterSummary = filtered.summary;
  const excludedSummary = dropped.excluded.map(({ name, links, reason }) => ({ name, links, reason }));
  const files = {
    md: path.join(outDir, 'navigation.md'),
    json: path.join(outDir, 'links.json'),
  };

  await writeFile(files.md, buildMarkdown({ site: result.site, categories: outputCategories, stats, generatedAt: nowIso, excludedSummary, sitePages: result.pages, riskSummary }), 'utf8');
  await writeFile(files.json, JSON.stringify(buildJson({ site: result.site, categories: outputCategories, stats, generatedAt: nowIso, excludedSummary, sitePages: result.pages, riskSummary, filterSummary: [...filterSummary.entries()].map(([reason, count]) => ({ reason, count })) }), null, 2), 'utf8');

  // 被过滤条目可能包含敏感内容，站点可通过 writeRejected=false 关闭落地
  if (site.writeRejected !== false) {
    files.rejected = path.join(outDir, 'rejected.json');
    await writeFile(files.rejected, JSON.stringify({ site: site.name, entry: site.entry, generatedAt: nowIso, total: filtered.rejected.length, items: filtered.rejected }, null, 2), 'utf8');
  }

  return {
    site: result.site,
    stats,
    filterSummary,
    riskSummary,
    files,
    warnings: result.warnings,
  };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = await readJson(opts.config, { defaults: {}, sites: [] });
  const blocklist = await readJson(opts.blocklist, {});
  const state = await loadState(path.join(opts.out, 'state.json'));
  const filter = createFilter(blocklist);

  const allSites = config.sites ?? [];
  if (opts.list || !allSites.length) {
    console.log('可用站点：');
    for (const s of allSites) {
      console.log(`  ${s.enabled === false ? '[停用]' : '[启用]'} ${s.name} -> ${s.entry}${s.note ? `  （${s.note}）` : ''}`);
    }
    console.log('\n用法：node src/cli.js --site <name|all> [--out 目录] [--no-deep] [--delay 毫秒] [--max-pages N]');
    return;
  }

  const targets =
    opts.site === 'all'
      ? allSites.filter((s) => s.enabled !== false)
      : allSites.filter((s) => s.name === opts.site || s.name === `{${opts.site}}`);

  if (!targets.length) {
    console.error(`未找到站点：${opts.site}；用 --list 查看可用站点。`);
    process.exitCode = 1;
    return;
  }

  console.log(`过滤规则：分类 ${filter.rules.categories.length} 条 / 关键词 ${filter.rules.strongKeywords.length + filter.rules.wordKeywords.length} 条 / 域名 ${filter.rules.domains.length} 条 / 白名单 ${filter.rules.allow.length} 条`);
  console.log(`输出目录：${opts.out}`);

  const results = [];
  for (const site of targets) {
    results.push(await runSite(site, opts, { defaults: config.defaults ?? {}, blocklist, state, filter }));
  }

  await saveState(path.join(opts.out, 'state.json'), state);
  console.log('\n--- 汇总 ---');
  results.forEach(printSiteSummary);
  const total = results.reduce((sum, r) => sum + r.stats.validLinks, 0);
  console.log(`\n共 ${results.length} 个站点，有效链接 ${total} 条。`);
}

main().catch((err) => {
  console.error(`运行失败：${err.stack || err.message}`);
  process.exitCode = 1;
});