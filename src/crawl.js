import { fetchPage, toUrl } from './fetcher.js';
import { extractNavigation, extractFollowLinks } from './extract.js';
import { deepMerge, hostOf, normalizeUrl, sleep } from './util.js';

function mergeGroups(target, incoming) {
  for (const cat of incoming) {
    let targetCat = target.find((c) => c.name === cat.name);
    if (!targetCat) {
      targetCat = { name: cat.name, subCategories: [] };
      target.push(targetCat);
    }
    for (const sub of cat.subCategories) {
      let targetSub = targetCat.subCategories.find((s) => s.name === sub.name);
      if (!targetSub) {
        targetSub = { name: sub.name, links: [] };
        targetCat.subCategories.push(targetSub);
      }
      for (const link of sub.links) {
        if (!targetSub.links.some((l) => l.url === link.url)) targetSub.links.push(link);
      }
    }
  }
}

/**
 * 抓取单个站点，返回合并后的分类结构与页面统计。
 */
export async function crawlSite(site, defaults = {}, options = {}) {
  const cfg = deepMerge(defaults, site);
  const rootDir = options.rootDir ?? process.cwd();
  const delayMs = options.delayMs ?? cfg.delayMs ?? 800;
  const maxPages = options.maxPages ?? cfg.maxPages ?? 30;
  if (options.deep === false) cfg.deep = { ...(cfg.deep ?? {}), enabled: false };

  const startUrl = toUrl(site.entry, rootDir);
  const queue = [{ url: startUrl, depth: 0 }];
  const visited = new Set();
  const pages = [];
  const categories = [];
  const warnings = [];

  while (queue.length && pages.length < maxPages) {
    const { url, depth } = queue.shift();
    const key = normalizeUrl(url);
    if (visited.has(key)) continue;
    visited.add(key);

    try {
      const page = await fetchPage(url, cfg.fetch ?? {});
      const baseUrl = page.url || url;
      const extracted = extractNavigation(page.html, baseUrl, cfg.selectors ?? {});
      mergeGroups(categories, extracted);

      const linkCount = extracted.reduce(
        (sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.links.length, 0),
        0,
      );
      pages.push({ url: baseUrl, depth, local: page.local, categories: extracted.length, links: linkCount });

      if (cfg.deep?.enabled && depth < (cfg.deep.maxDepth ?? 1)) {
        const followSel = cfg.deep.followSelector ?? cfg.selectors?.follow;
        const follows = extractFollowLinks(page.html, baseUrl, followSel);
        for (const href of follows) {
          if (cfg.deep.sameHostOnly !== false && hostOf(href) !== hostOf(baseUrl)) continue;
          if (!visited.has(normalizeUrl(href))) queue.push({ url: href, depth: depth + 1 });
        }
      }
    } catch (err) {
      warnings.push(`${url} -> ${err.message}`);
      console.warn(`[warn] ${err.message}`);
    }

    if (queue.length) await sleep(delayMs);
  }

  const rawLinks = categories.reduce(
    (sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.links.length, 0),
    0,
  );

  return {
    site: { name: site.name, entry: site.entry, note: site.note ?? '' },
    pages,
    categories,
    stats: { pages: pages.length, rawLinks, truncated: queue.length > 0 },
    warnings,
  };
}
