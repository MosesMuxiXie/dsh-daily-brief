/**
 * YouTube collector — no API key, no login.
 *
 * Channels publish a public RSS feed (`feeds/videos.xml?channel_id=…`), so a
 * channel only needs its handle resolved once; single videos fall back to the
 * oEmbed endpoint, which also works from networks where the watch page is
 * partially blocked.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { safeFetch } from '../fetch.js';
import { parseFeedXml } from './feed.js';
import { fetchVideoComments, mapLimit } from './youtube-comments.js';
import { stripHtml, truncate } from '../text.js';

const CHANNEL_CACHE_MS = 12 * 3600 * 1000;
const CHANNEL_ID_RE = /UC[\w-]{20,30}/;
const COMMENT_SCAN_DEFAULT = 6;
const COMMENT_SCAN_MAX = 10;
const COMMENT_SCAN_CONCURRENCY = 3;

function cachePath(storeDir, key) {
  if (!storeDir) return '';
  return path.join(storeDir, '.cache', `youtube-${key}.json`);
}

function readCache(file) {
  if (!file) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(file, value) {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
  } catch {
    /* cache is best-effort */
  }
}

function safeKey(value) {
  return String(value || 'unknown').replace(/[^\w-]+/g, '_').slice(0, 80);
}

const YOUTUBE_HEADERS = {
  'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};

/**
 * Parse every YouTube URL shape a user may paste. Returns null for other hosts.
 * @returns {{mode:'channel'|'video'|'playlist', handle?:string, channelId?:string, videoId?:string, playlistId?:string, url?:string}|null}
 */
export function parseYouTubeUrl(raw) {
  const input = String(raw || '').trim();
  if (input === '') return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') {
    const id = url.pathname.split('/').filter(Boolean)[0];
    return id ? { mode: 'video', videoId: id, url: `https://www.youtube.com/watch?v=${id}` } : null;
  }
  if (!/(^|\.)youtube\.com$/.test(host)) return null;

  const watchId = url.searchParams.get('v');
  if (url.pathname === '/watch' && watchId) {
    return { mode: 'video', videoId: watchId, url: `https://www.youtube.com/watch?v=${watchId}` };
  }
  const short = /^\/(shorts|embed|live)\/([\w-]{6,})/.exec(url.pathname);
  if (short) {
    return { mode: 'video', videoId: short[2], url: `https://www.youtube.com/watch?v=${short[2]}` };
  }
  if (url.pathname === '/playlist' && url.searchParams.get('list')) {
    return { mode: 'playlist', playlistId: url.searchParams.get('list') };
  }
  const handle = /^\/@([^/]+)/.exec(url.pathname);
  if (handle) {
    return { mode: 'channel', handle: decodeURIComponent(handle[1]) };
  }
  const channel = /^\/channel\/(UC[\w-]{20,30})/.exec(url.pathname);
  if (channel) return { mode: 'channel', channelId: channel[1] };
  const legacy = /^\/(?:c|user)\/([^/]+)/.exec(url.pathname);
  if (legacy) return { mode: 'channel', handle: decodeURIComponent(legacy[1]) };
  if (url.pathname === '/' || url.pathname === '') return { mode: 'channel', handle: '' };
  return null;
}

function cleanTitle(value) {
  return stripHtml(String(value || ''))
    .replace(/\s*[-–—]\s*YouTube\s*$/i, '')
    .trim();
}

function metaContent(root, key) {
  const wanted = key.toLowerCase();
  for (const node of root.querySelectorAll('meta')) {
    const name = (node.getAttribute('property') || node.getAttribute('name') || '').toLowerCase();
    if (name === wanted) {
      const content = node.getAttribute('content');
      if (content && content.trim() !== '') return content.trim();
    }
  }
  return '';
}

/**
 * Resolve an @handle (or /c/name) to a channel id by reading the channel page.
 * The canonical RSS <link rel="alternate"> is preferred; the page's externalId
 * is the fallback when YouTube renders a consent/shell page.
 */
export async function resolveYouTubeChannel(source, context = {}) {
  const options = source.options || {};
  if (options.channelId && CHANNEL_ID_RE.test(options.channelId)) {
    return { channelId: options.channelId, title: source.label || '' };
  }
  const parsed = parseYouTubeUrl(source.url) || {};
  const handle = String(options.handle || parsed.handle || '').trim();
  if (handle === '' && !parsed.channelId) {
    throw new Error('请填写 YouTube 频道链接（@handle 或 /channel/UC…）');
  }
  if (parsed.channelId) return { channelId: parsed.channelId, title: source.label || '' };

  const file = cachePath(context.storeDir, `channel-${safeKey(handle)}`);
  const cached = readCache(file);
  if (cached && cached.channelId && Date.now() - Number(cached.at || 0) < CHANNEL_CACHE_MS) {
    return cached;
  }
  const pageUrl = `https://www.youtube.com/@${encodeURIComponent(handle)}`;
  const response = await safeFetch(pageUrl, {
    timeoutMs: 20000,
    maxBytes: 8 * 1024 * 1024,
    headers: YOUTUBE_HEADERS,
  });
  const root = parse(response.text);
  let channelId = '';
  const feed = root.querySelector('link[rel="alternate"]');
  const href = feed?.getAttribute('href') || '';
  const match = /[?&]channel_id=(UC[\w-]{20,30})/.exec(href);
  if (match) channelId = match[1];
  if (channelId === '') {
    const external = /"externalId":"(UC[\w-]{20,30})"/.exec(response.text);
    channelId = external?.[1] || '';
  }
  if (channelId === '') {
    const loose = /channel_id=(UC[\w-]{20,30})/.exec(response.text);
    channelId = loose?.[1] || '';
  }
  if (channelId === '') throw new Error(`没有在 @${handle} 的频道页找到频道 ID（页面可能被拦截）`);
  const value = {
    channelId,
    title: cleanTitle(metaContent(root, 'og:title') || root.querySelector('title')?.textContent || handle),
    at: Date.now(),
  };
  writeCache(file, value);
  return value;
}

async function collectSingleVideo(source, parsed) {
  const options = source.options || {};
  const videoId = String(options.videoId || parsed.videoId || '').trim();
  if (!/^[\w-]{6,}$/.test(videoId)) throw new Error('这不是有效的 YouTube 视频链接');
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  let title = '';
  let author = '';
  let detail = '';
  let date = '';
  let bytes = 0;
  let elapsedMs = 0;

  try {
    const oembed = await safeFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`,
      { timeoutMs: 15000, headers: { accept: 'application/json' } },
    );
    bytes += oembed.bytes;
    elapsedMs += oembed.elapsedMs;
    const data = JSON.parse(oembed.text);
    title = cleanTitle(data.title || '');
    author = data.author_name || '';
  } catch {
    /* oEmbed is optional; the watch page is the fallback */
  }

  try {
    const response = await safeFetch(watchUrl, {
      timeoutMs: 20000,
      maxBytes: 8 * 1024 * 1024,
      headers: YOUTUBE_HEADERS,
    });
    bytes += response.bytes;
    elapsedMs += response.elapsedMs;
    const root = parse(response.text);
    title = title || cleanTitle(metaContent(root, 'og:title') || root.querySelector('title')?.textContent || '');
    detail = metaContent(root, 'og:description') || metaContent(root, 'description');
    const published =
      metaContent(root, 'article:published_time') ||
      /"uploadDate":"([^"]+)"/.exec(response.text)?.[1] ||
      /"publishDate":"([^"]+)"/.exec(response.text)?.[1] ||
      '';
    if (published !== '') {
      const parsedDate = new Date(published);
      date = Number.isNaN(parsedDate.getTime()) ? '' : parsedDate.toISOString();
    }
    if (author === '') {
      author = /"author":"([^"]+)"/.exec(response.text)?.[1] || '';
    }
  } catch {
    /* title from oEmbed is still usable */
  }

  if (title === '') throw new Error('打不开这个 YouTube 视频（可能被网络或登录页拦截）');
  return {
    items: [
      {
        id: `youtube-${videoId}`.slice(0, 300),
        title: truncate(title, 180),
        url: watchUrl,
        detail: truncate(detail || (author ? `视频 · ${author}` : '视频'), 190),
        date,
        meta: author || 'YouTube',
        badge: 'YouTube',
        tone: '',
      },
    ],
    note: author ? `来自 ${author} 的 YouTube 视频` : 'YouTube 视频',
    bytes,
    elapsedMs,
  };
}

function pageVideos(value, out = []) {
  if (!value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const item of value) pageVideos(item, out);
    return out;
  }
  if (value.videoRenderer) out.push({ kind: 'video', node: value.videoRenderer });
  if (value.lockupViewModel?.contentId) out.push({ kind: 'lockup', node: value.lockupViewModel });
  for (const key of Object.keys(value)) {
    if (key === 'videoRenderer' || key === 'lockupViewModel') continue;
    pageVideos(value[key], out);
  }
  return out;
}

function extractInitialData(html) {
  const marker = html.indexOf('ytInitialData');
  if (marker < 0) return null;
  const start = html.indexOf('{', marker);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function relativeDate(text, now = Date.now()) {
  const value = String(text || '').trim();
  if (value === '') return '';
  if (/^(刚刚|just now)$/i.test(value)) return new Date(now).toISOString();
  const english = /(\d+)\s*(second|minute|hour|day|week|month|year)s?\s*ago/i.exec(value);
  const chinese = /(\d+)\s*(秒|分钟|小时|天|周|个月|年)前/.exec(value);
  const match = english || chinese;
  if (!match) return '';
  const units = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: 86400000,
    week: 604800000,
    month: 2592000000,
    year: 31536000000,
    秒: 1000,
    分钟: 60000,
    小时: 3600000,
    天: 86400000,
    周: 604800000,
    个月: 2592000000,
    年: 31536000000,
  };
  const unit = units[match[2].toLowerCase()] ?? units[match[2]] ?? 0;
  if (!unit) return '';
  return new Date(now - Number(match[1]) * unit).toISOString();
}

function lockupParts(node) {
  const rows = node.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows || [];
  const parts = [];
  for (const row of rows) {
    for (const part of row?.metadataParts || []) {
      const text = String(part?.text?.content || '').trim();
      if (text) parts.push(text);
    }
  }
  return parts;
}

function pageVideoItem(entry, now, meta) {
  const node = entry.node;
  const videoId = String(entry.kind === 'lockup' ? node.contentId : node.videoId || '').trim();
  if (!/^[\w-]{6,}$/.test(videoId)) return null;
  let title = '';
  let description = '';
  let published = '';
  let views = '';
  if (entry.kind === 'lockup') {
    title = cleanTitle(node.metadata?.lockupMetadataViewModel?.title?.content || '');
    const parts = lockupParts(node);
    published = relativeDate(parts.find((part) => /(前|ago|just now|刚刚)$/i.test(part)) || '', now);
    views = parts.find((part) => /(次观看|观看|views?|万|亿)/i.test(part) && !/(前|ago)$/i.test(part)) || '';
  } else {
    title = cleanTitle((node.title?.runs || []).map((run) => run.text).join('') || node.title?.simpleText || '');
    description = (node.descriptionSnippet?.runs || []).map((run) => run.text).join(' ');
    published = relativeDate(node.publishedTimeText?.simpleText, now);
    views = node.viewCountText?.simpleText || '';
  }
  if (title === '') return null;
  return {
    id: `youtube-${videoId}`.slice(0, 300),
    title: truncate(title, 180),
    url: `https://www.youtube.com/watch?v=${videoId}`,
    detail: truncate(description || (views ? `观看 ${views}` : ''), 190),
    date: published,
    meta,
    badge: 'YouTube',
    tone: '',
  };
}

/** Fallback when the public channel RSS is rate-limited or returns 404. */
async function collectChannelPage(source, parsed, context = {}) {
  const options = source.options || {};
  const handle = String(options.handle || parsed.handle || '').trim();
  const pageUrl = parsed.channelId
    ? `https://www.youtube.com/channel/${encodeURIComponent(parsed.channelId)}/videos`
    : `https://www.youtube.com/@${encodeURIComponent(handle)}/videos`;
  const response = await safeFetch(pageUrl, {
    timeoutMs: 20000,
    maxBytes: 12 * 1024 * 1024,
    headers: YOUTUBE_HEADERS,
  });
  const data = extractInitialData(response.text);
  const entries = data ? pageVideos(data) : [];
  const channelTitle = cleanTitle(data?.metadata?.channelMetadataRenderer?.title || handle || 'YouTube');
  const now = Date.now();
  const items = [];
  const seen = new Set();
  for (const entry of entries.slice(0, 60)) {
    const item = pageVideoItem(entry, now, channelTitle);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    items.push(item);
  }
  if (items.length === 0) throw new Error(`@${handle || '频道'} 的 YouTube 页面暂时没有可读取的视频`);
  const cutoff = now - (options.sinceHours ?? 24) * 3600000;
  const fresh = items.filter((item) => !item.date || new Date(item.date).getTime() >= cutoff);
  const list = fresh.slice(0, options.limit ?? 8);
  if (list.length === 0) {
    return {
      status: 'skipped',
      items: [],
      note: '页面模式：这个频道最近没有符合时间范围的新视频',
      bytes: response.bytes,
      elapsedMs: response.elapsedMs,
    };
  }
  return {
    items: list,
    note: `来自 ${channelTitle} 的 YouTube 更新（页面模式）`,
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}

async function collectChannel(source, parsed, context) {
  const options = source.options || {};
  const playlist = parsed.mode === 'playlist';
  const channel = playlist ? { channelId: '', title: '' } : await resolveYouTubeChannel(source, context);
  const feedUrl = playlist
    ? `https://www.youtube.com/feeds/videos.xml?playlist_id=${encodeURIComponent(parsed.playlistId)}`
    : `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.channelId}`;
  let response = null;
  let feedError = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await safeFetch(feedUrl, { timeoutMs: 20000, headers: YOUTUBE_HEADERS });
      if (response.status < 400) break;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
    } catch (error) {
      feedError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  let items = [];
  let feedTitle = '';
  let bytes = response?.bytes || 0;
  let elapsedMs = response?.elapsedMs || 0;
  if (response && response.status < 400) {
    const parsedFeed = parseFeedXml(response.text);
    feedTitle = parsedFeed.feedTitle;
    items = parsedFeed.items;
  }
  if (items.length === 0) {
    // RSS is not always available (404/500 on some channels or after bursty
    // requests); the /videos page still carries the recent uploads.
    if (!playlist && !parsed.playlistId) return collectChannelPage(source, parsed, context);
    if (feedError) throw feedError;
    throw new Error('这个 YouTube 频道暂时没有可读取的视频');
  }
  const name = cleanTitle(feedTitle || channel.title || options.handle || '');
  const decorated = items.map((item) => ({
    ...item,
    meta: name || 'YouTube',
    badge: 'YouTube',
  }));
  const cutoff = Date.now() - (options.sinceHours ?? 24) * 3600000;
  const fresh = decorated.filter((item) => {
    if (!item.date) return true;
    return new Date(item.date).getTime() >= cutoff;
  });
  const list = (fresh.length > 0 ? fresh : decorated).slice(0, options.limit ?? 8);
  if (list.length === 0) throw new Error('这个 YouTube 频道暂时没有可读取的视频');
  return {
    items: list,
    note: name ? `来自 ${name} 的 YouTube 更新` : 'YouTube 频道更新',
    bytes,
    elapsedMs,
  };
}

function videoIdOf(url) {
  const match = /[?&]v=([\w-]{6,})/.exec(String(url || ''));
  return match?.[1] ?? '';
}

/**
 * Rank the freshly collected videos by comment total and remember the winner.
 * Counting is one cheap InnerTube call per video (cached for 6 hours); the top
 * comments are only fetched for the winner, so a channel costs a few seconds.
 */
async function enrichComments(list, options, context) {
  const items = Array.isArray(list) ? list : [];
  const requested = Number(options.commentScan ?? COMMENT_SCAN_DEFAULT);
  const scanLimit =
    options.comments === false
      ? 0
      : Math.max(0, Math.min(items.length, Number.isFinite(requested) ? requested : COMMENT_SCAN_DEFAULT, COMMENT_SCAN_MAX));
  if (scanLimit === 0) return { items, featured: null, bytes: 0, note: '' };

  let bytes = 0;
  let failures = 0;
  const scanned = await mapLimit(items.slice(0, scanLimit), COMMENT_SCAN_CONCURRENCY, async (item) => {
    const videoId = videoIdOf(item.url);
    if (videoId === '') return null;
    const stats = await fetchVideoComments(videoId, { storeDir: context.storeDir, withComments: false });
    bytes += stats.bytes || 0;
    if (stats.error) failures += 1;
    if (!Number.isFinite(stats.commentCount) || stats.commentCount <= 0) return null;
    item.commentCount = stats.commentCount;
    return item;
  });

  const ranked = scanned.filter(Boolean).sort((a, b) => (b.commentCount ?? 0) - (a.commentCount ?? 0));
  if (ranked.length === 0) {
    return {
      items,
      featured: null,
      bytes,
      note: failures > 0 ? '评论读取暂时不可用' : '',
    };
  }

  const best = ranked[0];
  const requestedComments = Number(options.commentsPerVideo ?? 4);
  const perVideo = Math.max(1, Math.min(6, Number.isFinite(requestedComments) ? requestedComments : 4));
  const full = await fetchVideoComments(videoIdOf(best.url), {
    storeDir: context.storeDir,
    withComments: true,
    maxComments: perVideo,
  });
  bytes += full.bytes || 0;
  const comments = (full.comments ?? []).slice(0, perVideo);
  best.comments = comments;
  return {
    items,
    featured: {
      id: best.id,
      title: best.title,
      url: best.url,
      date: best.date ?? '',
      meta: best.meta ?? 'YouTube',
      commentCount: best.commentCount,
      comments,
    },
    bytes,
    note: `评论最多：${truncate(best.title, 60)}（${best.commentCount} 条）`,
  };
}

export async function collectYouTube(source, context = {}) {
  const options = source.options || {};
  const parsed = {
    ...(parseYouTubeUrl(source.url) || {}),
    ...(options.videoId ? { mode: 'video', videoId: options.videoId } : {}),
    ...(options.playlistId ? { mode: 'playlist', playlistId: options.playlistId } : {}),
    ...(options.channelId ? { channelId: options.channelId } : {}),
    ...(options.handle ? { handle: String(options.handle).replace(/^@/, '') } : {}),
  };
  const result =
    parsed.mode === 'video' && parsed.videoId
      ? await collectSingleVideo(source, parsed)
      : await collectChannel(source, parsed, context);
  if (!result || !Array.isArray(result.items) || result.items.length === 0) return result;
  const enriched = await enrichComments(result.items, options, context);
  const note = [result.note, enriched.note].filter((part) => part && part !== '').join(' · ');
  return {
    ...result,
    items: enriched.items,
    featured: enriched.featured,
    note,
    bytes: (result.bytes || 0) + (enriched.bytes || 0),
  };
}
