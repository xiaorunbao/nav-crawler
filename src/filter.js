import { cleanText } from './util.js';

export const DEFAULT_BLOCKLIST = {
  categories: [
    '成人', '色情', '情色', '里番', '番号', '福利', '约啪', '约炮', '裸聊', '乱伦',
    '换妻', '人妻', '萝莉', '正太', '艳照', '黑料', '探花', '禁漫', '污漫', '肉番',
    '三级', '激情', '桃色', '淫', '嫖', '二奶', '一夜情', '同城约', '无码', '有码',
  ],
  strongKeywords: [
    'porn', 'xxx', 'hentai', 'nsfw', 'adult', '成人', '色情', '情色', '里番',
    '萝莉', '裸聊', '乱伦', '换妻', '约啪', '探花', '禁漫', '污漫', '肉番',
    '福利姬', '艳照', '三级片', '18+', 'r18', 'av女优', 'onlyfans',
  ],
  wordKeywords: [
    'jav', 'av', 'sex', 'milf', 'escort', 'nude', 'naked', 'erotic', 'camgirl',
    'amateur', 'stripper', 'pussy', 'dick', 'cum',
  ],
  domains: [],
  allow: [],
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isAsciiWord(token) {
  return /^[a-z0-9]+$/i.test(token);
}

function buildMatcher(token, strong) {
  const lower = token.toLowerCase();
  if (strong || !isAsciiWord(token)) {
    return (text) => text.includes(lower);
  }
  const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(lower)}([^a-z0-9]|$)`, 'i');
  return (text) => re.test(text);
}

function uniq(list) {
  return [...new Set(list.filter(Boolean).map((s) => cleanText(s)).filter(Boolean))];
}

function domainMatcher(domain) {
  const d = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  return (url) => {
    try {
      const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
      return host === d || host.endsWith(`.${d}`);
    } catch {
      return false;
    }
  };
}

/** 根据配置 + 内置清单构建过滤器 */
export function createFilter(blocklistConfig = {}) {
  const merged = {
    categories: uniq([...DEFAULT_BLOCKLIST.categories, ...(blocklistConfig.categories ?? []), ...(blocklistConfig.extraCategories ?? [])]),
    strongKeywords: uniq([...DEFAULT_BLOCKLIST.strongKeywords, ...(blocklistConfig.strongKeywords ?? []), ...(blocklistConfig.extraKeywords ?? [])]),
    wordKeywords: uniq([...DEFAULT_BLOCKLIST.wordKeywords, ...(blocklistConfig.wordKeywords ?? [])]),
    domains: uniq([...DEFAULT_BLOCKLIST.domains, ...(blocklistConfig.domains ?? [])]),
    allow: uniq([...DEFAULT_BLOCKLIST.allow, ...(blocklistConfig.allow ?? [])]).map((s) => s.toLowerCase()),
  };

  const catMatchers = merged.categories.map((t) => buildMatcher(t, true));
  const strongMatchers = merged.strongKeywords.map((t) => buildMatcher(t, true));
  const wordMatchers = merged.wordKeywords.map((t) => buildMatcher(t, false));
  const domainChecks = merged.domains.map(domainMatcher);

  const allowChecks = merged.allow.map((token) => {
    const isDomainLike = token.includes('.') && !token.includes(' ');
    return isDomainLike ? domainMatcher(token) : (url) => url.toLowerCase().includes(token);
  });

  /**
   * @param {{name?:string, desc?:string, url:string, category?:string, subCategory?:string}} item
   * @returns {{blocked:boolean, reason?:string}}
   */
  function evaluate(item) {
    const url = String(item.url ?? '');
    const urlLower = url.toLowerCase();
    if (allowChecks.some((check) => check(url)) || merged.allow.includes(urlLower)) {
      return { blocked: false };
    }

    const name = cleanText(item.name);
    const desc = cleanText(item.desc);
    const cat = cleanText(item.category);
    const sub = cleanText(item.subCategory);

    for (let i = 0; i < catMatchers.length; i += 1) {
      if ([cat, sub].some((text) => text && catMatchers[i](text.toLowerCase()))) {
        return { blocked: true, reason: `分类命中：${merged.categories[i]}` };
      }
    }
    for (let i = 0; i < strongMatchers.length; i += 1) {
      const texts = [name.toLowerCase(), desc.toLowerCase(), urlLower];
      if (texts.some((text) => strongMatchers[i](text))) {
        return { blocked: true, reason: `关键词命中：${merged.strongKeywords[i]}` };
      }
    }
    for (let i = 0; i < wordMatchers.length; i += 1) {
      const texts = [name.toLowerCase(), desc.toLowerCase(), urlLower];
      if (texts.some((text) => wordMatchers[i](text))) {
        return { blocked: true, reason: `关键词命中：${merged.wordKeywords[i]}` };
      }
    }
    for (const check of domainChecks) {
      if (check(url)) return { blocked: true, reason: '域名黑名单' };
    }
    return { blocked: false };
  }

  return { evaluate, rules: merged };
}