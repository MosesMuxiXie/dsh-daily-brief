/**
 * YouTube comment reader — InnerTube only, no API key, no login.
 *
 * Two hops on `youtubei/v1/next`:
 *  1. with a full WATCH context the response carries the comments engagement
 *     panel: its header holds the comment total ("710") and its content holds
 *     the continuation token for the first page of comments;
 *  2. replaying that token returns the top comments (by relevance) in
 *     `frameworkUpdates.entityBatchUpdate.mutations[].payload.commentEntityPayload`.
 *
 * Quirks worth remembering (verified against the live site):
 * - `hl` must be `en`; with `zh-CN` the header count loses its digits;
 * - the count only shows up when the request context looks like a watch page
 *   (`clientScreen: 'WATCH'` + `mainAppWebInfo.graftUrl`), otherwise YouTube
 *   answers with a leaner layout whose header has no `contextualInfo`;
 * - a logged-out client only returns ~20 comments per page, so this is a
 *   sample of the most relevant comments, never the full thread.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFetch } from '../fetch.js';
import { stripHtml, truncate } from '../text.js';

export const YT_CLIENT_VERSION = process.env.DSH_YT_CLIENT_VERSION || '2.20261111.01.00';
const INNERTUBE = 'https://www.youtube.com/youtubei/v1/next?prettyPrint=false';
const COMMENT_CACHE_MS = 6 * 3600 * 1000;
const COMMENT_TOKEN_MS = 40 * 60 * 1000;

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function cacheFile(storeDir, videoId) {
  if (!storeDir) return '';
  return path.join(storeDir, '.cache', `youtube-comments-${String(videoId).replace(/[^\w-]+/g, '_')}.json`);
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

export async function mapLimit(items, limit, fn) {
  const list = Array.from(items || []);
  const size = Math.max(1, Math.min(limit, list.length || 1));
  const out = new Array(list.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      out[index] = await fn(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: size }, worker));
  return out;
}

/** "710" / "1,234" / "1.2K" / "2.5万" / "12M" → number, or null. */
export function parseCountText(raw) {
  const text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return null;
  const match = /([\d.,]+)\s*(万|千|亿|[KkMmBb])?/.exec(text);
  if (!match) return null;
  let value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value)) return null;
  const unit = match[2] || '';
  if (unit === 'K' || unit === 'k' || unit === '千') value *= 1e3;
  else if (unit === 'M' || unit === 'm') value *= 1e6;
  else if (unit === 'B' || unit === 'b') value *= 1e9;
  else if (unit === '万') value *= 1e4;
  else if (unit === '亿') value *= 1e8;
  return Math.max(0, Math.round(value));
}

function walk(value, visit) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const entry of value) walk(entry, visit);
    return;
  }
  visit(value);
  for (const entry of Object.values(value)) walk(entry, visit);
}

function runText(node) {
  if (!node) return '';
  if (typeof node.simpleText === 'string') return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((run) => run?.text ?? '').join('');
  if (typeof node.content === 'string') return node.content;
  return '';
}

function watchContext(videoId) {
  return {
    client: {
      clientName: 'WEB',
      clientVersion: YT_CLIENT_VERSION,
      hl: 'en',
      gl: 'US',
      clientScreen: 'WATCH',
      mainAppWebInfo: {
        graftUrl: `/watch?v=${videoId}`,
        pwaInstallabilityStatus: 'PWA_INSTALLABILITY_STATUS_UNKNOWN',
        webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER',
        isWebNativeShareAvailable: false,
      },
      timeZone: 'Asia/Shanghai',
      utcOffsetMinutes: 480,
    },
    user: { lockedSafetyMode: false },
    request: { internalExperimentFlags: [], useSsl: true },
  };
}

function headers(videoId) {
  return {
    'content-type': 'application/json',
    'user-agent': BROWSER_UA,
    origin: 'https://www.youtube.com',
    referer: `https://www.youtube.com/watch?v=${videoId}`,
    'x-youtube-client-name': '1',
    'x-youtube-client-version': YT_CLIENT_VERSION,
    'accept-language': 'en-US,en;q=0.9',
  };
}

async function innertube(videoId, body, timeoutMs, maxBytes) {
  const response = await safeFetch(INNERTUBE, {
    method: 'POST',
    json: body,
    headers: headers(videoId),
    timeoutMs,
    maxBytes,
    accept: 'application/json',
  });
  if (response.status === 429) {
    const error = new Error('YouTube 评论接口被限流');
    error.code = 'RATE';
    throw error;
  }
  if (response.status >= 400) {
    const error = new Error(`YouTube 评论接口返回 ${response.status}`);
    error.code = response.status === 403 ? 'AUTH' : 'HTTP';
    throw error;
  }
  try {
    return { data: JSON.parse(response.text), bytes: response.bytes };
  } catch {
    throw new Error('YouTube 评论接口返回了无法解析的内容');
  }
}

/** Pull the comment total and the first-page token out of a watch `next` payload. */
export function readCommentPanel(data) {
  let commentCount = null;
  let token = '';
  for (const panel of data?.engagementPanels ?? []) {
    const section = panel?.engagementPanelSectionListRenderer;
    if (!section || section.panelIdentifier !== 'engagement-panel-comments-section') continue;
    const header = section.header?.engagementPanelTitleHeaderRenderer;
    const contextual = parseCountText(runText(header?.contextualInfo));
    const titleCount = parseCountText(runText(header?.title));
    if (contextual !== null) commentCount = contextual;
    else if (titleCount !== null && /comment/i.test(runText(header?.title))) commentCount = titleCount;
    walk(section.content, (node) => {
      const candidate = node.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token;
      if (!token && typeof candidate === 'string' && candidate !== '') token = candidate;
    });
  }
  if (commentCount === null) {
    // Older payload shapes.
    walk(data, (node) => {
      if (commentCount === null && node.commentsHeaderRenderer) {
        const header = node.commentsHeaderRenderer;
        commentCount = parseCountText(runText(header.commentsCount) || runText(header.countText));
      }
      if (commentCount === null && node.commentsEntryPointHeaderRenderer) {
        commentCount = parseCountText(runText(node.commentsEntryPointHeaderRenderer.commentCount));
      }
    });
  }
  return { commentCount, token };
}

/** Collect the comments of one continuation page, most liked first. */
export function readCommentsPage(data) {
  const comments = [];
  for (const mutation of data?.frameworkUpdates?.entityBatchUpdate?.mutations ?? []) {
    const payload = mutation?.payload?.commentEntityPayload;
    if (!payload) continue;
    const text = truncate(
      stripHtml(String(payload.properties?.content?.content ?? ''))
        .replace(/\s+/g, ' ')
        .trim(),
      220,
    );
    if (text === '') continue;
    comments.push({
      author: truncate(String(payload.author?.displayName ?? '').replace(/\s+/g, ' ').trim(), 60),
      text,
      likes: Number(String(payload.toolbar?.likeCountNotliked ?? '0').replace(/\D/g, '')) || 0,
      replies: Number(String(payload.toolbar?.replyCount ?? '0').replace(/\D/g, '')) || 0,
      published: truncate(String(payload.properties?.publishedTime ?? ''), 40),
    });
  }
  comments.sort((a, b) => b.likes - a.likes);
  return comments;
}

/**
 * Read the comment total — and, when asked, the top comments — of one video.
 * Never throws for ordinary network/target failures: the caller ranks videos,
 * and one unreachable video must not take the whole source down.
 *
 * @returns {Promise<{videoId:string, commentCount:number|null, comments:Array<object>,
 *   sampled:number, error?:string, bytes:number, elapsedMs:number}>}
 */
export async function fetchVideoComments(videoId, options = {}) {
  const {
    storeDir = '',
    withComments = true,
    maxComments = 6,
    timeoutMs = 15000,
    maxBytes = 8 * 1024 * 1024,
    cacheMs = COMMENT_CACHE_MS,
    force = false,
  } = options;
  const id = String(videoId || '').trim();
  const started = Date.now();
  if (!/^[\w-]{6,}$/.test(id)) {
    return { videoId: id, commentCount: null, comments: [], sampled: 0, error: 'invalid', bytes: 0, elapsedMs: 0 };
  }

  const file = cacheFile(storeDir, id);
  const cached = force ? null : readCache(file);
  const fresh = cached && Date.now() - Number(cached.at || 0) < cacheMs;
  let commentCount = fresh ? (cached.commentCount ?? null) : null;
  let token = fresh ? String(cached.token || '') : '';
  let comments = fresh && Array.isArray(cached.comments) ? cached.comments : [];
  const tokenFresh = fresh && Date.now() - Number(cached.at || 0) < COMMENT_TOKEN_MS;
  let bytes = 0;

  if (!fresh || (commentCount === null && token === '')) {
    try {
      const first = await innertube(id, { context: watchContext(id), videoId: id, contentCheckOk: true, racyCheckOk: true }, timeoutMs, maxBytes);
      bytes += first.bytes;
      const panel = readCommentPanel(first.data);
      commentCount = panel.commentCount;
      token = panel.token;
    } catch (error) {
      const code = error?.code === 'RATE' ? 'rate' : error?.code === 'AUTH' ? 'auth' : 'fetch';
      // A cached count is still better than nothing when the panel is unreachable.
      if (!fresh || commentCount === null) {
        return {
          videoId: id,
          commentCount,
          comments,
          sampled: comments.length,
          error: code,
          bytes,
          elapsedMs: Date.now() - started,
        };
      }
    }
  }

  if (withComments && comments.length === 0 && token !== '' && tokenFresh) {
    try {
      const second = await innertube(id, { context: watchContext(id), continuation: token }, timeoutMs, Math.min(maxBytes, 4 * 1024 * 1024));
      bytes += second.bytes;
      comments = readCommentsPage(second.data).slice(0, Math.max(1, maxComments));
    } catch {
      /* comments are optional; the count still ranks the video */
    }
  }

  writeCache(file, { at: Date.now(), commentCount, token, comments });
  return {
    videoId: id,
    commentCount,
    comments,
    sampled: comments.length,
    bytes,
    elapsedMs: Date.now() - started,
  };
}

export function resetCommentCache(storeDir, videoId) {
  const file = cacheFile(storeDir, videoId);
  if (!file) return;
  try {
    fs.rmSync(file, { force: true });
  } catch {
    /* ignore */
  }
}
