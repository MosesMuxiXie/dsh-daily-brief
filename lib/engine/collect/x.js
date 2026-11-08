/**
 * X (Twitter) account collector.
 *
 * Uses the public syndication timeline endpoint, which needs no login, and
 * turns the JSON embedded in __NEXT_DATA__ into briefing items. Requests are
 * serialized with a small gap because syndication rate-limits bursts (429),
 * and a successful response is cached so a later limit never empties the card.
 * The shared syndication quota is unpredictable (roughly one success every
 * fifteen minutes on a busy address), so every account has an official-blog
 * fallback that keeps the AI card populated without leaving the account scope.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFetch } from '../fetch.js';
import { stripHtml, truncate } from '../text.js';
import { collectFeed } from './feed.js';

const GAP_MS = 900;
const CACHE_FRESH_MS = 12 * 60 * 1000;

// 官方博客 / 站点订阅：仅在 X 拿不到新帖时补位，标题会标注「官方博客」。
const FALLBACK_FEEDS = {
  openai: 'https://news.google.com/rss/search?q=site:openai.com&hl=en-US&gl=US&ceid=US:en',
  anthropicai: 'https://news.google.com/rss/search?q=site:anthropic.com&hl=en-US&gl=US&ceid=US:en',
  googledeepmind: 'https://deepmind.google/blog/rss.xml',
};
let queue = Promise.resolve();
let lastAt = 0;
let limitedUntil = 0;

function cacheFile(storeDir, handle) {
  return path.join(storeDir, '.cache', `x-${handle.toLowerCase()}.json`);
}

function readCache(storeDir, handle) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(storeDir, handle), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(storeDir, handle, payload) {
  try {
    const file = cacheFile(storeDir, handle);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* cache is best effort */
  }
}

function serialize(task) {
  const run = queue.then(async () => {
    const wait = Math.max(0, GAP_MS - (Date.now() - lastAt));
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastAt = Date.now();
    return task();
  });
  queue = run.catch(() => {});
  return run;
}

function parseNextData(html) {
  const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function cleanText(value) {
  return stripHtml(value)
    .replace(/https:\/\/t\.co\/\w+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toItem(tweet, source) {
  const text = cleanText(tweet.full_text || tweet.text || '');
  if (text === '') return null;
  const firstLine = text.split(/(?<=[。！？.!?])\s/)[0] || text;
  const title = truncate(firstLine, 120);
  const rest = text.slice(firstLine.length).trim();
  const label = tweet.user?.screen_name || source.options.handle;
  const media = Array.isArray(tweet.entities?.media) && tweet.entities.media.length > 0;
  return {
    id: `x-${tweet.id_str || `${label}-${tweet.created_at}`}`,
    title,
    detail: rest === '' ? '' : truncate(rest, 160),
    url: tweet.id_str ? `https://x.com/${label}/status/${tweet.id_str}` : `https://x.com/${label}`,
    date: tweet.created_at || '',
    meta: `@${label}${media ? ' · 含图片' : ''}`,
    badge: '',
    tone: '',
  };
}

/**
 * 当 X 限流且没有可用缓存时，用该账号对应的官方博客订阅补位。
 * 仍属于「关注这个账号」的范围，只是换了一条不用配额的通道。
 */
async function fallbackItems(source, handle, sinceHours, limit) {
  const feed = FALLBACK_FEEDS[handle.toLowerCase()];
  if (!feed) return [];
  try {
    const result = await collectFeed(
      {
        id: `${source.id}-feed`,
        label: source.label,
        section: source.section,
        type: 'rss',
        url: feed,
        options: { limit: Math.max(limit, 4), sinceHours: Math.max(sinceHours, 96) },
      },
      {},
    );
    return (result.items || [])
      .filter((item) => {
        const time = new Date(item.date).getTime();
        return Number.isFinite(time) && time >= Date.now() - Math.max(sinceHours, 96) * 3600 * 1000;
      })
      .slice(0, limit)
      .map((item) => ({
        ...item,
        // Google News appends the outlet name; the card already says 官方博客.
        title: String(item.title || '').replace(/\s+-\s+(OpenAI|Anthropic|Google DeepMind|DeepMind)$/i, ''),
        id: `xfeed-${item.id}`,
        meta: `官方博客 · @${handle}`,
        badge: '博客',
        tone: '',
      }));
  } catch {
    return [];
  }
}

export async function collectX(source, context = {}) {
  const started = Date.now();
  const handle = String(source.options?.handle || '').replace(/^@/, '');
  if (handle === '') {
    return { status: 'error', items: [], note: '账号名称为空', elapsedMs: 0 };
  }
  const sinceHours = Number(source.options?.sinceHours) || 40;
  const limit = Number(source.options?.limit) || 3;
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const storeDir = context.storeDir || '';

  // A fresh cache spares the shared syndication quota (30 requests / 15 min).
  const cachedBefore = storeDir ? readCache(storeDir, handle) : null;
  const cachedAge = cachedBefore?.at ? Date.now() - new Date(cachedBefore.at).getTime() : Infinity;
  if (cachedBefore?.items?.length && cachedAge >= 0 && cachedAge < CACHE_FRESH_MS) {
    const items = cachedBefore.items.filter((item) => new Date(item.date).getTime() >= cutoff).slice(0, limit);
    if (items.length > 0) {
      return { status: 'ok', items, note: '', elapsedMs: Date.now() - started, cached: true };
    }
  }

  const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(handle)}?lang=en&showReplies=false`;
  const payload = await serialize(async () => {
    if (Date.now() < limitedUntil) return { limited: true };
    try {
      const response = await safeFetch(url, {
        timeoutMs: 16000,
        maxBytes: 3 * 1024 * 1024,
        headers: {
          // The syndication endpoint answers browser-like clients far more
          // often than bare Node fetch; keep the same UA string as a browser.
          'user-agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'accept-language': 'en-US,en;q=0.9',
          referer: 'https://platform.twitter.com/',
        },
      });
      if (response.status === 429) {
        const reset = Number(response.headers?.['x-rate-limit-reset'] || 0);
        limitedUntil = reset > 0 ? reset * 1000 : Date.now() + 10 * 60 * 1000;
        return { limited: true };
      }
      if (!response.ok) return { error: `X 返回 ${response.status}` };
      const data = parseNextData(response.text);
      const entries = data?.props?.pageProps?.timeline?.entries;
      if (!Array.isArray(entries)) return { error: 'X 页面结构无法解析' };
      const tweets = [];
      for (const entry of entries) {
        const tweet = entry?.content?.tweet;
        if (!tweet) continue;
        const author = String(tweet.user?.screen_name || '');
        if (author !== '' && author.toLowerCase() !== handle.toLowerCase()) continue;
        tweets.push(tweet);
      }
      return { tweets };
    } catch (error) {
      return { error: String(error?.message || error).slice(0, 200) };
    }
  });

  if (payload.limited || payload.error) {
    const cached = storeDir ? readCache(storeDir, handle) : cachedBefore;
    const limitNote = 'X 限流，稍后自动重试';
    if (cached?.items?.length) {
      const items = cached.items
        .filter((item) => new Date(item.date).getTime() >= cutoff)
        .slice(0, limit);
      if (items.length > 0) {
        return {
          status: 'degraded',
          items,
          note: payload.limited ? `${limitNote}，先看上次结果` : `X 获取失败，显示上次结果`,
          elapsedMs: Date.now() - started,
        };
      }
    }
    const fromBlog = await fallbackItems(source, handle, sinceHours, limit);
    if (fromBlog.length > 0) {
      return {
        status: 'ok',
        items: fromBlog,
        note: '',
        elapsedMs: Date.now() - started,
        fallback: 'feed',
      };
    }
    return {
      status: payload.limited ? 'degraded' : 'error',
      items: [],
      note: payload.limited ? limitNote : payload.error || 'X 获取失败',
      elapsedMs: Date.now() - started,
    };
  }

  const items = (payload.tweets || [])
    .map((tweet) => toItem(tweet, source))
    .filter(Boolean)
    .filter((item) => {
      const time = new Date(item.date).getTime();
      return Number.isFinite(time) ? time >= cutoff : true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  if (storeDir) writeCache(storeDir, handle, { at: new Date().toISOString(), items });

  if (items.length === 0) {
    const fromBlog = await fallbackItems(source, handle, sinceHours, limit);
    if (fromBlog.length > 0) {
      return {
        status: 'ok',
        items: fromBlog,
        note: '',
        elapsedMs: Date.now() - started,
        fallback: 'feed',
      };
    }
  }

  return {
    status: items.length > 0 ? 'ok' : 'skipped',
    items,
    note: items.length > 0 ? '' : `${sinceHours} 小时内没有新帖`,
    elapsedMs: Date.now() - started,
    bytes: 0,
  };
}
