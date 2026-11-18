import { cleanText } from './util.js';

function escapeMd(text) {
  return String(text ?? '').replace(/[\\[\]]/g, '\\$&').replace(/\|/g, '\\|');
}

function countOf(node) {
  return node.linkCount ?? node.links?.length ?? 0;
}

const LEVEL_LABEL = {
  clean: 'clean（0%）',
  low: 'low（<15%）',
  medium: 'medium（15%~40%）',
  high: 'high（≥40%）',
};

const LEVEL_ORDER = ['clean', 'low', 'medium', 'high'];

export function buildJson({ site, categories, stats, generatedAt, filterSummary, excludedSummary, sitePages, riskSummary }) {
  const risks = riskSummary ?? [];
  const byLevel = {};
  for (const level of LEVEL_ORDER) byLevel[level] = risks.filter((r) => r.level === level).length;

  return {
    meta: {
      site: site.name,
      entry: site.entry,
      note: site.note ?? '',
      generatedAt,
      generator: 'nav-crawler',
      structureOnly: stats.structureOnly === true,
    },
    stats: {
      pages: stats.pages,
      rawLinks: stats.rawLinks,
      validLinks: stats.validLinks,
      uniqueLinks: stats.uniqueLinks,
      filteredLinks: stats.filteredLinks,
      excludedLinks: stats.excludedLinks ?? 0,
      newLinks: stats.newLinks,
      totalCategories: categories.length,
      totalSubCategories: categories.reduce((sum, c) => sum + c.subCategories.length, 0),
    },
    navPages: sitePages ?? [],
    riskLevels: byLevel,
    riskSummary: risks,
    filterSummary,
    excludedCategories: excludedSummary ?? [],
    categories,
  };
}

export function buildMarkdown({ site, categories, stats, generatedAt, excludedSummary, sitePages, riskSummary }) {
  const lines = [];
  const structureOnly = stats.structureOnly === true;
  const risks = riskSummary ?? [];

  lines.push(`# ${site.name}｜垂直领域导航`, '');
  lines.push(`> 数据源：${site.entry}`);
  if (site.note) lines.push(`> 备注：${site.note}`);
  lines.push(`> 抓取时间：${generatedAt}`);
  lines.push(
    `> 页面 ${stats.pages} 个｜条目 ${stats.validLinks} 条｜唯一链接 ${stats.uniqueLinks} 个｜已过滤 ${stats.filteredLinks} 条｜${stats.firstRun ? '首次采集' : `新增 ${stats.newLinks} 条`}`,
    '',
  );
  if (structureOnly) {
    lines.push('> 本文件为**结构快照**：仅保留分类骨架与条目数量，不落地具体链接与描述。', '');
  }

  if (!categories.length) {
    lines.push('_本次没有抓取到有效链接，请检查选择器配置或目标站点结构。_');
    return lines.join('\n');
  }

  if (sitePages?.length) {
    lines.push('## 二级导航页面', '');
    for (const page of sitePages) {
      const extra = page.sidebar === false ? '' : page.labels?.length > 1 ? `（含 ${page.labels.length} 个入口）` : '';
      const links = page.links ? `｜条目 ${page.links}` : '';
      lines.push(`- ${page.label}${extra}：${page.url}｜分类 ${page.categories ?? 0}${links}`);
    }
    lines.push('');
  }

  lines.push('## 分类目录', '');
  categories.forEach((cat, i) => {
    const src = cat.pageLabels?.length ? ` — ${cat.pageLabels.join('、')}` : '';
    lines.push(`${i + 1}. ${cat.name}（${countOf(cat)}）${src}`);
  });
  lines.push('');

  if (risks.length) {
    lines.push('## 分类合规度', '');
    lines.push(
      '> 启发式聚合统计，仅输出计数与比例，不落地条目。adult 复用内置过滤判定，piracy / gambling 为关键词信号，**需人工复核**，不构成法律判断。',
      '',
    );
    lines.push(
      `> 分档：${LEVEL_ORDER.map((lv) => `${lv} ${risks.filter((r) => r.level === lv).length}`).join('｜')}（共 ${risks.length} 个分类，含过滤后整类清空、已不在分类目录中的）`,
      '',
    );

    for (const level of LEVEL_ORDER) {
      const group = risks.filter((r) => r.level === level).sort((a, b) => b.links - a.links);
      if (!group.length) continue;
      lines.push(`### ${LEVEL_LABEL[level]} — ${group.length} 个分类`, '');
      if (level === 'clean') lines.push('无任何风险信号，可直接作为收录候选。', '');
      for (const r of group) {
        const parts = [`${r.links} 条`];
        if (level !== 'clean') parts.push(`成人 ${r.adult} / 盗版 ${r.piracy} / 博彩 ${r.gambling}`);
        if ((level === 'medium' || level === 'high') && r.signals?.length) {
          parts.push(`信号：${r.signals.map((s) => `${s.reason} × ${s.count}`).join('、')}`);
        }
        const src = r.pageLabels?.length > 1 ? `（${r.pageLabels.join('、')}）` : '';
        const emptied = r.emptied ? ' `已整类过滤`' : '';
        const sparse = r.links > 0 && r.links < 5 ? ' `样本少`' : '';
        lines.push(`- ${r.name}${src}（${parts.join('，')}）${emptied}${sparse}`);
      }
      lines.push('');
    }
  }

  for (const cat of categories) {
    lines.push(`## ${cat.name}（${countOf(cat)}）`, '');
    if (cat.pageLabels?.length) lines.push(`> 来源页面：${cat.pageLabels.join('、')}`, '');
    for (const sub of cat.subCategories) {
      lines.push(`### ${sub.name}（${countOf(sub)}）`, '');
      if (!structureOnly) {
        for (const link of sub.links) {
          const desc = cleanText(link.desc);
          const mark = link.isNew ? ' `新增`' : '';
          lines.push(`- [${escapeMd(link.name)}](${link.url})${mark}${desc ? ` — ${desc}` : ''}`);
        }
        lines.push('');
      }
    }
  }

  if (excludedSummary?.length) {
    lines.push('## 按策略排除的分类', '');
    for (const item of excludedSummary) {
      lines.push(`- ${item.name}（${item.links}）— ${item.reason}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trim()}\n`;
}