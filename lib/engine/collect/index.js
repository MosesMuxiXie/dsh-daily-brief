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
import { truncate } from '../text.js';

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

function normalizeItem(item, source) {
  return {
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
    return {
      sourceId: source.id,
      status: result?.status ?? (items.length > 0 ? 'ok' : 'skipped'),
      items,
      note: result?.note ?? '',
      bytes: result?.bytes,
      server: result?.server,
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
