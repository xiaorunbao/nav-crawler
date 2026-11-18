import * as cheerio from 'cheerio';
import { cleanText, truncate } from './util.js';

const SKIP_HREF = /^(javascript:|mailto:|tel:|#|$)/i;

function resolveHref(href, baseUrl) {
  const raw = String(href ?? '').trim();
  if (SKIP_HREF.test(raw)) return null;
  try {
    return new URL(raw, baseUrl).href;
  } catch {
    return null;
  }
}

function nameOf($, $scope, selector) {
  if (selector) {
    const $node = $scope.find(selector).first();
    if ($node.length) return cleanText($node.text());
  }
  return '';
}

function inferNameDesc($, $a, selectors) {
  if (selectors.linkName || selectors.linkDesc) {
    return {
      name: nameOf($, $a, selectors.linkName) || cleanText($a.attr('title')) || cleanText($a.text()),
      desc: nameOf($, $a, selectors.linkDesc) || cleanText($a.attr('data-desc')),
    };
  }
  // 未配置选择器：先按常见类名推断，再退化为“第一个子元素=标题，其余=描述”
  const $title = $a.find('.title,.name,.nav-name,.site-name,strong,h3,h4,h5').first();
  const $desc = $a.find('.desc,.description,.sub-title,.subtitle,.intro,.summary,.note,p').first();
  if ($title.length) {
    return { name: cleanText($title.text()), desc: cleanText($desc.text()) };
  }
  const children = $a.children();
  if (children.length) {
    const $copy = $a.clone();
    $copy.children().first().remove();
    return { name: cleanText(children.first().text()), desc: cleanText($copy.text()) };
  }
  return {
    name: cleanText($a.attr('title')) || cleanText($a.text()),
    desc: cleanText($a.attr('data-desc')),
  };
}

function buildLink($, el, baseUrl, selectors) {
  const $a = $(el);
  const url = resolveHref($a.attr('href'), baseUrl);
  if (!url) return null;
  const inferred = inferNameDesc($, $a, selectors);
  const name = inferred.name;
  if (!name) return null;
  const desc = inferred.desc;
  return { name: truncate(name, 80), url, desc: truncate(desc, 200) };
}

/**
 * 从分类容器里收集链接。
 * mode='self'  -> 只收集归属于当前子分类容器的链接
 * mode='outside' -> 只收集不属于任何子分类容器的直接链接
 * mode='all'   -> 全部收集
 */
function collectLinks($, scope, selectors, mode = 'all') {
  const out = [];
  const subSel = selectors.subCategory;
  const $scope = $(scope);
  const isSubScope = Boolean(subSel) && $scope.is(subSel);

  $scope.find(selectors.link || 'a').each((_, el) => {
    if (subSel && mode !== 'all') {
      const owner = $(el).closest(subSel).get(0) ?? null;
      if (mode === 'self' && owner !== (isSubScope ? scope : null)) return;
      if (mode === 'outside' && owner !== null) return;
    }
    const link = buildLink($, el, selectors.__baseUrl, selectors);
    if (link) out.push(link);
  });
  return out;
}

function addGroup(groups, categoryName, subCategoryName, links) {
  if (!links.length) return;
  let cat = groups.find((g) => g.name === categoryName);
  if (!cat) {
    cat = { name: categoryName, subCategories: [] };
    groups.push(cat);
  }
  const subName = subCategoryName || '全部站点';
  let sub = cat.subCategories.find((s) => s.name === subName);
  if (!sub) {
    sub = { name: subName, links: [] };
    cat.subCategories.push(sub);
  }
  for (const link of links) {
    if (!sub.links.some((l) => l.url === link.url)) sub.links.push(link);
  }
}

/** 目标站点没有分类容器时的通用兜底：按标题层级切分 */
function extractGeneric($, pageUrl, selectors) {
  const groups = [];
  let catName = '未分类';
  let subName = null;
  const linkSel = selectors.link && selectors.link !== 'a' ? selectors.link : 'a';
  const nodes = $('body').find('h1,h2,h3,h4,h5,h6,a').toArray();
  const temp = new Map();

  const ensure = (cat, sub) => {
    const key = `${cat}\u0000${sub ?? ''}`;
    if (!temp.has(key)) temp.set(key, []);
    return temp.get(key);
  };

  for (const node of nodes) {
    const tag = node.tagName?.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const text = cleanText($(node).text());
      if (!text) continue;
      const level = Number(tag.slice(1));
      if (level <= 2) {
        catName = text;
        subName = null;
      } else {
        subName = text;
      }
      ensure(catName, subName);
      continue;
    }
    if (tag === 'a' && !$(node).closest('header,footer').length) {
      const link = buildLink($, node, pageUrl, { linkName: null, linkDesc: null });
      if (!link) continue;
      ensure(catName, subName).push(link);
    }
  }

  for (const [key, links] of temp.entries()) {
    const [cat, sub] = key.split('\u0000');
    addGroup(groups, cat, sub || null, links);
  }
  if (!groups.length) {
    const all = collectLinks($, $('body').get(0), { ...selectors, link: 'a' }, 'all');
    if (all.length) addGroup(groups, '未分类', null, all);
  }
  return groups;
}

/**
 * 解析一个页面的导航结构。
 * @returns {Array<{name:string, subCategories:Array<{name:string, links:Array}>}>}
 */
export function extractNavigation(html, pageUrl, rawSelectors = {}) {
  const selectors = { ...rawSelectors, link: rawSelectors.link || 'a', __baseUrl: pageUrl };
  const $ = cheerio.load(html);
  const groups = [];

  if (!selectors.category) {
    return extractGeneric($, pageUrl, selectors);
  } else {
    const catEls = $(selectors.category).toArray();
    if (!catEls.length) return extractGeneric($, pageUrl, selectors);

    for (const catEl of catEls) {
      const catName =
        nameOf($, $(catEl), selectors.categoryName) ||
        cleanText($(catEl).attr('data-cat')) ||
        cleanText($(catEl).find('h1,h2,h3').first().text()) ||
        '未命名分类';

      const subEls = selectors.subCategory ? $(catEl).find(selectors.subCategory).toArray() : [];

      if (subEls.length) {
        for (const subEl of subEls) {
          const subName =
            nameOf($, $(subEl), selectors.subCategoryName) ||
            cleanText($(subEl).attr('data-sub')) ||
            cleanText($(subEl).find('h3,h4').first().text()) ||
            '未分组';
          addGroup(groups, catName, subName, collectLinks($, subEl, selectors, 'self'));
        }
        addGroup(groups, catName, '未分组', collectLinks($, catEl, selectors, 'outside'));
      } else {
        addGroup(groups, catName, null, collectLinks($, catEl, selectors, 'all'));
      }
    }
    return groups;
  }
}

/** 提取深抓需要跟随的翻页/子导航链接 */
export function extractFollowLinks(html, pageUrl, selector) {
  if (!selector) return [];
  const $ = cheerio.load(html);
  const out = [];
  $(selector).each((_, el) => {
    const url = resolveHref($(el).attr('href'), pageUrl);
    if (url && !out.includes(url)) out.push(url);
  });
  return out;
}
