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
const SLOW_TYPES = new Set(['imap', 'graph', 'browser', 'x', 'steam', 'youtube', 'bilibili']);

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
  const collector = COLLECTORS[source.type];
  if (!collector) {
    return { sourceId: source.id, status: 'error', items: [], note: `不支持的来源类型：${source.type}`, elapsedMs: 0 };
  }
  const timeoutMs = SLOW_TYPES.has(source.type) ? 35000 : 22000;
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
    return {
      sourceId: source.id,
      status: result?.status ?? (items.length > 0 ? 'ok' : 'skipped'),
      items,
      note: result?.note ?? '',
      bytes: result?.bytes,
      server: result?.server,
      ...(featured ? { featured } : {}),
      elapsedMs: result?.elapsedMs ?? Date.now() - started,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
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
