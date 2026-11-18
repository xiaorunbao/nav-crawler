import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { sleep } from './util.js';

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const ACCEPT =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';

/** 把配置里的 entry 统一成绝对 URL；本地相对路径转成 file:// */
export function toUrl(target, rootDir = process.cwd()) {
  const raw = String(target ?? '').trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) return raw;
  if (raw.toLowerCase().startsWith('file:')) return raw;
  return pathToFileURL(path.resolve(rootDir, raw)).href;
}

export function isLocalUrl(url) {
  return String(url).toLowerCase().startsWith('file:');
}

function detectCharset(buf, contentType) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || '')?.[1];
  if (fromHeader) return fromHeader;
  const head = buf.subarray(0, 2048).toString('latin1');
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ||
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1];
  return fromMeta || 'utf-8';
}

function decodeBody(buf, contentType) {
  const charset = detectCharset(buf, contentType);
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buf);
  } catch {
    return buf.toString('utf8');
  }
}

/**
 * 抓取单个页面。支持 http(s) 与本地文件。
 * @returns {Promise<{url:string, html:string, status:number, local:boolean}>}
 */
export async function fetchPage(target, options = {}) {
  const { timeout = 20000, retries = 2, headers = {}, cookie = '' } = options;

  if (isLocalUrl(target)) {
    const file = fileURLToPath(target);
    const html = await readFile(file, 'utf8');
    return { url: target, html, status: 200, local: true };
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const res = await fetch(target, {
        redirect: 'follow',
        signal: controller.signal,
        headers: {
          'user-agent': DEFAULT_UA,
          accept: ACCEPT,
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const buf = Buffer.from(await res.arrayBuffer());
      return {
        url: res.url || target,
        html: decodeBody(buf, res.headers.get('content-type')),
        status: res.status,
        local: false,
      };
    } catch (err) {
      lastError = err;
      if (attempt < retries) await sleep(400 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`抓取失败 ${target} -> ${lastError?.message || '未知错误'}`);
}
