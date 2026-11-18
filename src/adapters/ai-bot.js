import * as cheerio from 'cheerio';
import { fetchPage } from '../fetcher.js';
import { cleanText, hostOf, sleep, truncate } from '../util.js';

const INTERNAL_DEFAULT = 'ai-bot.cn';
const DEFAULT_SUB = '精选工具';

function paneLabelMap($) {
  const map = new Map();
  $('a.tab-noajax').each((_, el) => {
    const href = ($(el).attr('href') || '').trim();
    if (!href.startsWith('#')) return;
    const label = cleanText($(el).text());
    if (label) map.set(href.slice(1), label);
  });
  return map;
}

function parseCard($, el) {
  const $body = $(el);
  const $a = $body.find('a').first();
  if (!$a.length) return null;

  const dataUrl = cleanText($a.attr('data-url'));
  const detailUrl = cleanText($a.attr('href'));
  const url = dataUrl || detailUrl;
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const name =
    cleanText($body.find('strong').first().text()) ||
    cleanText($a.attr('title')) ||
    cleanText($body.find('img').attr('alt')) ||
    cleanText($a.text());
  if (!name) return null;

  const desc =
    cleanText($body.find('p.text-muted').first().text()) ||
    cleanText($body.find('.text-xs').first().text()) ||
    cleanText($a.attr('title')) ||
    '';

  return {
    name: truncate(name, 60),
    desc: truncate(desc, 160),
    url,
    detailUrl: /^https?:\/\//i.test(detailUrl) ? detailUrl : '',
  };
}

/** 解析首页：按文档顺序把卡片归到最近的前置 h4 大类，Tab 面板提供子类名 */
function parseHomepage(html, baseUrl) {
  const $ = cheerio.load(html);
  const paneLabels = paneLabelMap($);

  const categories = [];
  const seenCat = new Map();
  const nodes = $('h4.text-gray, .url-body').toArray();
  let current = '热门工具';

  for (const node of nodes) {
    const tag = String(node.tagName || '').toLowerCase();
    if (tag === 'h4') {
      const name = cleanText($(node).text());
      if (name) current = name;
      continue;
    }
    const card = parseCard($, node);
    if (!card) continue;

    const $pane = $(node).closest('.tab-pane');
    const paneId = $pane.length ? ($pane.attr('id') || '') : '';
    const subName = (paneId && paneLabels.get(paneId)) || DEFAULT_SUB;

    if (!seenCat.has(current)) {
      const entry = { name: current, subCategories: [] };
      seenCat.set(current, entry);
      categories.push(entry);
    }
    const cat = seenCat.get(current);
    let sub = cat.subCategories.find((s) => s.name === subName);
    if (!sub) {
      sub = { name: subName, links: [] };
      cat.subCategories.push(sub);
    }
    if (!sub.links.some((l) => l.url === card.url)) sub.links.push(card);
  }

  return { categories, baseUrl };
}

/** 站内详情页 -> 真实官网链接 */
async function resolveExternal(detailUrl, fetchOptions, internalHost) {
  const page = await fetchPage(detailUrl, fetchOptions);
  const $ = cheerio.load(page.html);
  const candidates = $('a.btn[href], a.btn-arrow[href]').toArray();
  for (const el of candidates) {
    const href = cleanText($(el).attr('href'));
    if (!/^https?:\/\//i.test(href)) continue;
    if (hostOf(href) === internalHost) continue;
    return href;
  }
  return null;
}

/**
 * ai-bot.cn（onenav 主题）适配器：
 * 首页大类 + 卡片外链，站内详情链接再解析一次真实官网地址。
 */
export async function crawl(site, defaults = {}, options = {}) {
  const cfg = { ...defaults, ...site, fetch: { ...(defaults.fetch ?? {}), ...(site.fetch ?? {}) } };
  const delayMs = options.delayMs ?? cfg.delayMs ?? 700;
  const internalHost = hostOf(site.entry) || INTERNAL_DEFAULT;
  const warnings = [];

  const home = await fetchPage(site.entry, cfg.fetch);
  const { categories } = parseHomepage(home.html, home.url || site.entry);

  let total = 0;
  const pending = [];
  for (const cat of categories) {
    for (const sub of cat.subCategories) {
      for (const link of sub.links) {
        total += 1;
        if (hostOf(link.url) === internalHost && link.detailUrl) pending.push(link);
      }
    }
  }

  let resolved = 0;
  for (const link of pending) {
    try {
      const external = await resolveExternal(link.detailUrl, cfg.fetch, internalHost);
      if (external) {
        link.url = external;
        link.resolvedFrom = link.detailUrl;
        resolved += 1;
      } else {
        link.internal = true;
        warnings.push(`未能解析官网地址：${link.name}（${link.detailUrl}）`);
      }
    } catch (err) {
      link.internal = true;
      warnings.push(`详情页抓取失败：${link.detailUrl} -> ${err.message}`);
    }
    await sleep(delayMs);
  }

  const rawLinks = categories.reduce(
    (sum, cat) => sum + cat.subCategories.reduce((s, sub) => s + sub.links.length, 0),
    0,
  );

  return {
    site: { name: site.name, entry: site.entry, note: site.note ?? '' },
    pages: [{ url: site.entry, depth: 0, links: rawLinks, categories: categories.length }],
    categories,
    stats: { pages: 1 + pending.length, rawLinks, resolved, unresolved: pending.length - resolved },
    warnings,
  };
}
