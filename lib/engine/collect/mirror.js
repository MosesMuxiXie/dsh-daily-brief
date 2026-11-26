/**
 * RSSHub mirror access for sources that are blocked on a direct connection.
 *
 * x.com, syndication.twitter.com and some YouTube endpoints are unreachable
 * from mainland networks without a proxy. Public RSSHub instances publish the
 * same public timelines as RSS, and several of them are reachable directly.
 * Requests go through http-direct.js so an abandoned proxy setting cannot
 * strand them.
 */
import { fetchDirectText } from '../http-direct.js';
import { parseFeedXml } from './feed.js';
import { truncate } from '../text.js';

export const MIRRORS = [
  'https://rsshub.ktachibana.party',
  'https://rsshub.woodland.cafe',
  'https://hub.slarker.me',
  'https://rsshub.bestblogs.dev',
];

const RATE_LIMIT_COOLDOWN_MS = 10 * 60 * 1000;
const ERROR_COOLDOWN_MS = 5 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_TOTAL_MS = 12000;
const MAX_CONCURRENT = 2;
const health = new Map();
const waiters = [];
let activeCalls = 0;
let cursor = 0;

function acquire() {
  if (activeCalls < MAX_CONCURRENT) {
    activeCalls += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiters.push(resolve));
}

function release() {
  const next = waiters.shift();
  if (next) next();
  else activeCalls -= 1;
}

async function withSlot(task) {
  await acquire();
  try {
    return await task();
  } finally {
    release();
  }
}

function raceTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export function resetMirrorHealth() {
  health.clear();
  cursor = 0;
}

function mark(host, ms) {
  health.set(host, { until: Date.now() + ms });
}

function cooling(host) {
  const entry = health.get(host);
  return Boolean(entry && entry.until > Date.now());
}

function statusCooldown(status) {
  if (status === 429 || status >= 500) return RATE_LIMIT_COOLDOWN_MS;
  return ERROR_COOLDOWN_MS;
}

/**
 * Try mirrors in order and return the first usable response.
 * @returns {Promise<{ok:true,status:number,text:string,bytes:number,mirror:string}>}
 */
export async function mirrorText(path, options = {}) {
  const mirrors = Array.isArray(options.mirrors) && options.mirrors.length > 0 ? options.mirrors : MIRRORS;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const totalMs = Number(options.totalMs) > 0 ? Number(options.totalMs) : DEFAULT_TOTAL_MS;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 2 * 1024 * 1024;
  const fetchDirect = options.fetchDirect || fetchDirectText;
  const suffix = String(path || '').startsWith('/') ? String(path) : `/${String(path || '')}`;
  const failures = [];
  const deadline = Date.now() + totalMs;
  const start = mirrors.length > 0 ? cursor++ % mirrors.length : 0;
  const ordered = mirrors.slice(start).concat(mirrors.slice(0, start));

  return withSlot(async () => {
    for (const base of ordered) {
    const host = String(base).replace(/\/+$/, '');
    if (host === '') continue;
    if (cooling(host)) {
      failures.push(`${host}: 冷却中`);
      continue;
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      failures.push('镜像总预算已用完');
      break;
    }
    const attemptTimeout = Math.min(timeoutMs, remaining);
    const url = `${host}${suffix}`;
    try {
      const response = await raceTimeout(
        fetchDirect(url, {
          timeoutMs: attemptTimeout,
          maxBytes,
          headers: { accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.5' },
        }),
        attemptTimeout + 250,
        `请求超时（${Math.max(1, Math.round(attemptTimeout / 1000))} 秒）`,
      );
      if (response?.ok && response.text) {
        return {
          ok: true,
          status: response.status || 200,
          text: response.text,
          bytes: response.bytes || 0,
          mirror: host,
        };
      }
      const status = Number(response?.status || 0);
      mark(host, statusCooldown(status));
      failures.push(`${host}: HTTP ${status || '错误'}`);
    } catch (error) {
      mark(host, ERROR_COOLDOWN_MS);
      failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

    const error = new Error(`镜像不可用（${truncate(failures.join('；'), 200)}）`);
    error.code = 'MIRROR';
    throw error;
  });
}

function idOfUrl(url) {
  const match = /\/status\/(\d+)/.exec(String(url || ''));
  return match?.[1] || '';
}

/** RSSHub's Twitter route as tweet-shaped values for the existing X pipeline. */
export function tweetsFromMirrorFeed(xml, handle) {
  const { items } = parseFeedXml(xml);
  return items
    .map((item) => {
      const text = String(item.detail || '').length > String(item.title || '').length ? item.detail : item.title;
      const fullText = String(text || '').trim();
      if (fullText === '') return null;
      return {
        id_str: idOfUrl(item.url) || String(item.id || ''),
        full_text: fullText,
        created_at: item.date || '',
        screen_name: handle,
        has_media: false,
      };
    })
    .filter(Boolean);
}

/** RSSHub's YouTube route as briefing items. */
export function youtubeItemsFromMirrorFeed(xml, fallbackName = '') {
  const { feedTitle, items } = parseFeedXml(xml);
  const meta =
    String(feedTitle || '')
      .replace(/\s*[-–—]\s*YouTube\s*$/i, '')
      .trim() ||
    String(fallbackName || '').trim() ||
    'YouTube';
  return items.map((item) => ({
    ...item,
    meta,
    badge: 'YouTube',
    tone: '',
  }));
}
