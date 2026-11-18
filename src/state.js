import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeUrl } from './util.js';

const EMPTY = { version: 1, sites: {} };

export async function loadState(file) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    return { version: parsed.version ?? 1, sites: parsed.sites ?? {} };
  } catch {
    return structuredClone(EMPTY);
  }
}

export async function saveState(file, state) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), 'utf8');
}

/**
 * 给链接打上 isNew / firstSeen 标记，并同步更新状态。
 * @param {Array} categories 分类结构
 * @param {object} siteState 单个站点的状态片段（会被就地更新）
 */
export function applyState(categories, siteState, nowIso, { markNew = true } = {}) {
  const now = nowIso || new Date().toISOString();
  let newCount = 0;

  for (const cat of categories) {
    for (const sub of cat.subCategories) {
      for (const link of sub.links) {
        const key = normalizeUrl(link.url);
        const record = siteState[key];
        if (!record) {
          siteState[key] = { name: link.name, firstSeen: now, lastSeen: now, category: cat.name, subCategory: sub.name };
          link.isNew = markNew;
          link.firstSeen = now;
          newCount += 1;
        } else {
          record.lastSeen = now;
          record.name = link.name;
          record.category = cat.name;
          record.subCategory = sub.name;
          link.isNew = false;
          link.firstSeen = record.firstSeen;
        }
      }
    }
  }
  return { newCount };
}
