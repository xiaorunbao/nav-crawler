import * as cheerio from 'cheerio';
import { fetchPage } from '../fetcher.js';
import { cleanText, hostOf, normalizeUrl, sleep, truncate } from '../util.js';

const DEFAULT_SUB = '全部站点';
const HTTP = /^https?:\/\//i;
const PAGE_HREF = /\.html?(?:[?#].*)?$/i;

/** 卡片外链藏在 data-original-title 或 onclick 的 myopener() 里，href 只是 javascript:void(); */
function cardUrl($el) {
  const title = cleanText($el.attr('data-original-title'));
  if (HTTP.test(title)) return title;
  const onclick = String($el.attr('onclick') || '');
  const match = /(?:myopener|window\.open)\s*\(\s*['"]([^'"]+)['"]/i.exec(onclick);
  const url = cleanText(match?.[1] ?? '');
  return HTTP.test(url) ? url : '';
}

function parseCard($, el) {
  const $card = $(el);
  const url = cardUrl($card);
  if (!url) return null;

  const name =
    cleanText($card.find('.xe-comment strong').first().text()) ||
    cleanText($card.find('a.xe-user-name').first().text()) ||
    cleanText($card.find('img').attr('alt'));
  if (!name) return null;

  const desc = cleanText($card.find('p.overflowClip_2').first().text());
  return { name: truncate(name, 80), url, desc: truncate(desc, 200) };
}

/** 左侧 #main-menu 里指向其它 .html 页面的链接 = 二级导航页面；纯 #锚点跳过 */
function discoverSidebarPages(html, baseUrl) {
  const $ = cheerio.load(html);
  const host = hostOf(baseUrl);
  const pages = [];

  $('#main-menu a[href]').each((_, el) => {
    const href = cleanText($(el).attr('href'));
    if (!PAGE_HREF.test(href)) return;

    let url;
    try {
      url = new URL(href, baseUrl).href;
    } catch {
      return;
    }
    if (hostOf(url) !== host) return;

    const key = normalizeUrl(url);
    const existing = pages.find((p) => p.key === key);
    const label =
      cleanText($(el).find('.title').first().text()) ||
      cleanText($(el).text()) ||
      url.split('/').pop();

    if (existing) {
      if (!existing.labels.includes(label)) existing.labels.push(label);
      return;
    }
    pages.push({ key, url: url.split('#')[0], labels: [label] });
  });

  return pages;
}

/** 按文档顺序把卡片归到最近的前置 h4 分类，并记录来源页面 */
function parsePage(html, pageLabel) {
  const $ = cheerio.load(html);
  const categories = [];
  const byName = new Map();
  let current = '未分类';

  const nodes = $('h4.text-gray, .xe-widget.xe-conversations').toArray();
  for (const node of nodes) {
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'h4') {
      const name = cleanText($(node).text());
      if (name) current = name;
      continue;
    }

    const card = parseCard($, node);
    if (!card) continue;

    let cat = byName.get(current);
    if (!cat) {
      cat = { name: current, pageLabels: [pageLabel], subCategories: [] };
      byName.set(current, cat);
      categories.push(cat);
    }
    let sub = cat.subCategories.find((s) => s.name === DEFAULT_SUB);
    if (!sub) {
      sub = { name: DEFAULT_SUB, links: [] };
      cat.subCategories.push(sub);
    }
    if (!sub.links.some((link) => link.url === card.url)) sub.links.push(card);
  }

  return categories;
}

/** 同名分类跨页面合并，并累积来源页面标签 */
function mergeCategories(target, incoming) {
  for (const cat of incoming) {
    let merged = target.find((c) => c.name === cat.name);
    if (!merged) {
      merged = { name: cat.name, pageLabels: [], subCategories: [] };
      target.push(merged);
    }
    for (const label of cat.pageLabels) {
      if (!merged.pageLabels.includes(label)) merged.pageLabels.push(label);
    }
    for (const sub of cat.subCategories) {
      let targetSub = merged.subCategories.find((s) => s.name === sub.name);
      if (!targetSub) {
        targetSub = { name: sub.name, links: [] };
        merged.subCategories.push(targetSub);
      }
      for (const link of sub.links) {
        if (!targetSub.links.some((l) => l.url === link.url)) targetSub.links.push(link);
      }
    }
  }
}

/**
 * jubt5.one（XenForo 风格导航模板）适配器：
 * 首页 + 左侧菜单指向的二级导航页，统一按 h4 大类 + .xe-widget 卡片解析，
 * 卡片外链取 data-original-title / myopener()，同名分类跨页面合并。
 */
export async function crawl(site, defaults = {}, options = {}) {
  const cfg = { ...defaults, ...site, fetch: { ...(defaults.fetch ?? {}), ...(site.fetch ?? {}) } };
  const delayMs = options.delayMs ?? cfg.delayMs ?? 700;
  const maxPages = options.maxPages ?? cfg.maxPages ?? 30;

  const entryUrl = site.entry;
  const pages = [];
  const categories = [];
  const warnings = [];

  const first = await fetchPage(entryUrl, cfg.fetch);
  const entryBase = first.url || entryUrl;
  const sidebarPages = discoverSidebarPages(first.html, entryBase);

  const entryLabel = '首页';
  const entryParsed = parsePage(first.html, entryLabel);
  mergeCategories(categories, entryParsed);
  pages.push({
    url: entryBase,
    label: entryLabel,
    sidebar: false,
    categories: entryParsed.length,
    links: entryParsed.reduce((sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.links.length, 0), 0),
  });

  for (const page of sidebarPages) {
    if (pages.length >= maxPages) {
      warnings.push(`页面数量达到上限 ${maxPages}，其余二级导航页未抓取`);
      break;
    }
    if (pages.some((p) => normalizeUrl(p.url) === page.key)) continue;

    await sleep(delayMs);
    try {
      const fetched = await fetchPage(page.url, cfg.fetch);
      const label = page.labels[0];
      const parsed = parsePage(fetched.html, label);
      mergeCategories(categories, parsed);
      pages.push({
        url: fetched.url || page.url,
        label,
        labels: page.labels,
        sidebar: true,
        categories: parsed.length,
        links: parsed.reduce((sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.links.length, 0), 0),
      });
    } catch (err) {
      warnings.push(`${page.url} -> ${err.message}`);
      console.warn(`[warn] ${err.message}`);
    }
  }

  const rawLinks = categories.reduce(
    (sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.links.length, 0),
    0,
  );

  return {
    site: { name: site.name, entry: site.entry, note: site.note ?? '' },
    pages,
    categories,
    stats: { pages: pages.length, rawLinks },
    warnings,
  };
}