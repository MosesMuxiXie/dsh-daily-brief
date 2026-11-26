/**
 * Collector dispatch: one source in, one normalized result out.
 * Failures are values, not exceptions, so a single broken source never stops
 * the briefing.
 */
import { collectFeed } from './feed.js';
import { collectIcs } from './ics.js';
import { collectJson } from './json.js';
import { collectPage } from './page.js';
import { collectHttp } from './http.js';
import { collectBrowser } from './browser.js';
import { collectImap } from './imap.js';
import { collectGraph } from './graph.js';
import { collectManageBac } from './managebac.js';
import { collectYouTube } from './youtube.js';
import { collectBilibili } from './bilibili.js';
import { collectX } from './x.js';
import { collectSteam } from './steam.js';
import { collectMinecraft } from './minecraft.js';
import { plainCommentText, truncate } from '../text.js';
import fs from 'node:fs';
import path from 'node:path';

export const COLLECTORS = {
  x: collectX,
  steam: collectSteam,
  minecraft: collectMinecraft,
  rss: collectFeed,
  atom: collectFeed,
  json: collectJson,
  ics: collectIcs,
  page: collectPage,
  http: collectHttp,
  browser: collectBrowser,
  imap: collectImap,
  graph: collectGraph,
  managebac: collectManageBac,
  youtube: collectYouTube,
  bilibili: collectBilibili,
};

// X serializes its requests, Steam retries once, and video sites do several
// API hops (channel id, feed, WBI signature), so these need more headroom.
// The budgets are deliberately below the old 35 s: a blocked host should fail
// fast enough for the collector's mirror/cache fallback to still run.
const SOURCE_TIMEOUTS = {
  browser: 40000,
  x: 24000,
  youtube: 26000,
  bilibili: 24000,
  steam: 20000,
  imap: 24000,
  graph: 24000,
};
const DEFAULT_TIMEOUT_MS = 15000;
const STALE_CACHE_MS = 7 * 24 * 3600 * 1000;

// Monitors must report the live server state, so they never serve stale data.
// Everything that is a "feed of things" may fall back to its last good copy.
const CACHEABLE_TYPES = new Set(['x', 'youtube', 'bilibili', 'rss', 'atom', 'json', 'page', 'steam', 'minecraft', 'managebac']);

function sourceCachePath(storeDir, sourceId) {
  const safe = String(sourceId || 'source')
    .replace(/[^\w.-]+/g, '_')
    .slice(0, 80);
  return path.join(storeDir, '.cache', `source-${safe}.json`);
}

function readSourceCache(storeDir, sourceId) {
  if (!storeDir) return null;
  try {
    const payload = JSON.parse(fs.readFileSync(sourceCachePath(storeDir, sourceId), 'utf8'));
    if (!Array.isArray(payload?.items) || payload.items.length === 0) return null;
    const at = new Date(payload.at).getTime();
    if (!Number.isFinite(at) || Date.now() - at > STALE_CACHE_MS) return null;
    return { at, items: payload.items, featured: payload.featured ?? null };
  } catch {
    return null;
  }
}

function writeSourceCache(storeDir, sourceId, items, featured) {
  if (!storeDir) return;
  try {
    const file = sourceCachePath(storeDir, sourceId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), items, featured: featured ?? null }), 'utf8');
  } catch {
    /* cache is best effort */
  }
}

function stamp(ms) {
  const date = new Date(ms);
  const two = (value) => String(value).padStart(2, '0');
  return `${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`;
}

function staleResult(source, cached, message, started) {
  const items = (cached?.items ?? [])
    .map((item) => normalizeItem(item, source))
    .filter((item) => item.title !== '');
  if (items.length === 0) return null;
  const featured = normalizeFeatured(cached.featured, source);
  return {
    sourceId: source.id,
    status: 'degraded',
    items,
    note: truncate(`${message}，显示上次结果（${stamp(cached.at)}）`, 240),
    ...(featured ? { featured } : {}),
    elapsedMs: Date.now() - started,
  };
}

function normalizeComments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 4)
    .map((comment) => ({
      author: truncate(String(comment?.author ?? '').replace(/\s+/g, ' ').trim(), 48),
      text: truncate(plainCommentText(comment?.text), 220),
      likes: Number(comment?.likes) > 0 ? Math.round(Number(comment.likes)) : 0,
      replies: Number(comment?.replies) > 0 ? Math.round(Number(comment.replies)) : 0,
    }))
    .filter((comment) => comment.text !== '');
}

function normalizeFeatured(featured, source) {
  if (!featured || typeof featured !== 'object') return null;
  const commentCount = Number(featured.commentCount);
  return {
    id: truncate(String(featured.id ?? featured.url ?? ''), 300),
    title: truncate(String(featured.title ?? ''), 200),
    url: typeof featured.url === 'string' ? featured.url : '',
    date: typeof featured.date === 'string' ? featured.date : '',
    meta: truncate(String(featured.meta ?? ''), 80),
    commentCount: Number.isFinite(commentCount) && commentCount > 0 ? Math.round(commentCount) : 0,
    comments: normalizeComments(featured.comments),
    sourceId: source.id,
    sourceLabel: source.label,
    section: source.section,
  };
}

function normalizeItem(item, source) {
  const out = {
    id: truncate(String(item.id ?? item.url ?? item.title ?? `${Math.random()}`), 300),
    title: truncate(String(item.title ?? ''), 200),
    url: typeof item.url === 'string' ? item.url : '',
    detail: truncate(String(item.detail ?? ''), 240),
    date: typeof item.date === 'string' ? item.date : '',
    meta: truncate(String(item.meta ?? ''), 80),
    badge: truncate(String(item.badge ?? ''), 12),
    tone: ['good', 'warn', 'bad', 'accent'].includes(item.tone) ? item.tone : '',
    sourceId: source.id,
    sourceLabel: source.label,
  };
  const commentCount = Number(item.commentCount);
  if (Number.isFinite(commentCount) && commentCount > 0) out.commentCount = Math.round(commentCount);
  const comments = normalizeComments(item.comments);
  if (comments.length > 0) out.comments = comments;
  return out;
}

export async function collectSource(source, context = {}) {
  const started = Date.now();
  if (!source || source.enabled === false) {
    return { sourceId: source?.id, status: 'disabled', items: [], note: '已停用', elapsedMs: 0 };
  }
  const collector = context.collectors?.[source.type] ?? COLLECTORS[source.type];
  if (!collector) {
    return { sourceId: source.id, status: 'error', items: [], note: `不支持的来源类型：${source.type}`, elapsedMs: 0 };
  }
  const timeoutMs = SOURCE_TIMEOUTS[source.type] ?? DEFAULT_TIMEOUT_MS;
  let timer;
  try {
    const result = await Promise.race([
      collector(source, context),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`获取超时（${Math.round(timeoutMs / 1000)} 秒）`)), timeoutMs);
      }),
    ]);
    const items = (result?.items ?? []).map((item) => normalizeItem(item, source)).filter((item) => item.title !== '');
    const featured = normalizeFeatured(result?.featured, source);
    const status = result?.status ?? (items.length > 0 ? 'ok' : 'skipped');
    if (CACHEABLE_TYPES.has(source.type) && items.length > 0) {
      writeSourceCache(context.storeDir, source.id, items, featured);
    }
    // Some collectors turn failures into values instead of throwing.
    if (items.length === 0 && (status === 'error' || status === 'degraded')) {
      const cached = CACHEABLE_TYPES.has(source.type) ? readSourceCache(context.storeDir, source.id) : null;
      const stale = cached ? staleResult(source, cached, result?.note || '获取失败', started) : null;
      if (stale) return stale;
    }
    return {
      sourceId: source.id,
      status,
      items,
      note: result?.note ?? '',
      bytes: result?.bytes,
      server: result?.server,
      ...(featured ? { featured } : {}),
      elapsedMs: result?.elapsedMs ?? Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cached = CACHEABLE_TYPES.has(source.type) ? readSourceCache(context.storeDir, source.id) : null;
    const stale = cached ? staleResult(source, cached, message, started) : null;
    if (stale) return stale;
    return {
      sourceId: source.id,
      status: error?.code === 'AUTH' ? 'auth' : 'error',
      items: [],
      note: truncate(message, 240),
      elapsedMs: Date.now() - started,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
