import { normalizeUrl } from './util.js';

/**
 * 分类合规度评估：只输出聚合计数与比例，不落地任何条目本身。
 * adult 复用 filter 的判定（含分类名命中），piracy/gambling 是启发式信号，
 * 结果仅供人工复核参考，不构成法律判断。
 */
export const DEFAULT_RISK_RULES = {
  piracy: [
    '磁力', '种子', 'torrent', '资源采集', '采集站', '盗版', '破解', 'm3u8',
    '书源', '迅雷', 'ed2k', '下载站', '影视下载', '电影下载', '剧集下载',
    '字幕站', '字幕下载', '网盘搜索', '网盘资源', '小说下载', '电子书下载',
    '无损音乐下载', '资源下载', '付费墙', 'paywall',
  ],
  /**
   * 分类名命中即整类标记：只放"本身就是风险载体"的词。
   * 不放网盘/下载站这类泛词，避免把合法的网盘工具、软件下载站整类误判。
   */
  nameTokens: [
    '磁力', '种子', 'torrent', '破解', '盗版', '资源采集', '采集站',
    '书源', 'm3u8', '迅雷', 'ed2k',
  ],
  gambling: [
    '博彩', '菠菜', '娱乐城', '彩票', '百家乐', '棋牌', '六合彩', '真人视讯',
    'casino', 'betting',
  ],
  thresholds: { low: 0.15, medium: 0.4 },
};

const WORD_RULES = new Set(['torrent', 'casino', 'betting', 'paywall']);

function matchTokens(haystack, tokens) {
  const lower = haystack.toLowerCase();
  const hit = tokens.find((token) => {
    const t = token.toLowerCase();
    return WORD_RULES.has(t)
      ? new RegExp(`\\b${t}\\b`, 'i').test(lower)
      : lower.includes(t);
  });
  return hit ?? null;
}

function levelOf(ratio, thresholds) {
  if (ratio === 0) return 'clean';
  if (ratio < thresholds.low) return 'low';
  if (ratio < thresholds.medium) return 'medium';
  return 'high';
}

/**
 * @returns {{ name, links, adult, piracy, gambling, ratio, level, signals }[]}
 */
export function assessCategories(categories, { filter, rules = DEFAULT_RISK_RULES }) {
  const merged = {
    piracy: [...DEFAULT_RISK_RULES.piracy, ...(rules.piracy ?? [])],
    nameTokens: [...DEFAULT_RISK_RULES.nameTokens, ...(rules.nameTokens ?? [])],
    gambling: [...DEFAULT_RISK_RULES.gambling, ...(rules.gambling ?? [])],
    thresholds: { ...DEFAULT_RISK_RULES.thresholds, ...(rules.thresholds ?? {}) },
  };

  const results = [];
  for (const cat of categories) {
    const seen = new Set();
    const catPiracy = matchTokens(cat.name, merged.nameTokens);
    let links = 0;
    let adult = 0;
    let piracy = 0;
    let gambling = 0;
    const signals = new Map();

    for (const sub of cat.subCategories) {
      for (const link of sub.links) {
        const key = normalizeUrl(link.url);
        if (seen.has(key)) continue;
        seen.add(key);
        links += 1;

        const verdict = filter.evaluate({
          name: link.name,
          desc: link.desc,
          url: link.url,
          category: cat.name,
          subCategory: sub.name,
        });
        if (verdict.blocked) {
          adult += 1;
          const key2 = verdict.reason ?? '未标注';
          signals.set(key2, (signals.get(key2) ?? 0) + 1);
          continue;
        }

        if (catPiracy) {
          piracy += 1;
          const reason = `分类名：${catPiracy}`;
          signals.set(reason, (signals.get(reason) ?? 0) + 1);
          continue;
        }

        const hay = `${link.name} ${link.desc} ${link.url}`;
        const p = matchTokens(hay, merged.piracy);
        if (p) {
          piracy += 1;
          const reason = `盗版：${p}`;
          signals.set(reason, (signals.get(reason) ?? 0) + 1);
          continue;
        }
        const g = matchTokens(hay, merged.gambling);
        if (g) {
          gambling += 1;
          const reason = `博彩：${g}`;
          signals.set(reason, (signals.get(reason) ?? 0) + 1);
        }
      }
    }

    const risky = adult + piracy + gambling;
    const ratio = links ? Number((risky / links).toFixed(4)) : 0;

    results.push({
      name: cat.name,
      pageLabels: cat.pageLabels ?? [],
      links,
      adult,
      piracy,
      gambling,
      ratio,
      level: levelOf(ratio, merged.thresholds),
      signals: [...signals.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([reason, count]) => ({ reason, count })),
    });
  }

  return results;
}