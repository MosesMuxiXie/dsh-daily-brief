/**
 * Bilibili comments — two public reply endpoints, no login required.
 *
 *   /x/v2/reply/count?type=1&oid=<aid>              → { count }
 *   /x/v2/reply/main?type=1&oid=<aid>&mode=3&next=0 → { top_replies, replies, cursor }
 *
 * Counts are exact for every video. A logged-out client is only shown three
 * replies per call (the web player behaves the same way), so the card shows at
 * most a handful of hot comments; adding a Cookie to the source raises the cap.
 * Replies come back already ordered by relevance, but we sort by likes anyway
 * so the card is stable between runs.
 *
 * The module takes a `getJson(url, referer)` callback instead of fetching on its
 * own: bilibili.js already owns the buvid cookie, the 400 ms gap and the saved
 * per-source Cookie header, and both callers must share them.
 */
import fs from 'node:fs';
import path from 'node:path';
import { plainCommentText as stripEmotes, stripHtml, truncate } from '../text.js';
import { mapLimit } from './youtube-comments.js';

export { plainCommentText } from '../text.js';

export const COMMENT_CACHE_MS = 6 * 3600 * 1000;
export const COMMENT_SCAN_DEFAULT = 6;
export const COMMENT_SCAN_MAX = 10;
export const COMMENT_CONCURRENCY = 2;

function cachePath(storeDir, aid) {
  if (!storeDir) return '';
  return path.join(storeDir, '.cache', `bilibili-comments-${aid}.json`);
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

/** Reply count already carried by a list payload (space/ranking/view). */
export function commentCountFromVideo(video) {
  const candidates = [video?.stat?.reply, video?.comment, video?.reply_count, video?.rcount];
  for (const raw of candidates) {
    const value = Number(raw);
    if (Number.isFinite(value) && value > 0) return Math.round(value);
  }
  return 0;
}

/** One API reply → the flat shape the briefing card renders. */
export function normalizeReply(reply) {
  const ctime = Number(reply?.ctime);
  return {
    id: String(reply?.rpid_str || reply?.rpid || ''),
    author: truncate(String(reply?.member?.uname || reply?.member?.name || '').trim(), 48),
    text: truncate(stripEmotes(reply?.content?.message), 220),
    likes: Math.max(0, Math.round(Number(reply?.like) || 0)),
    replies: Math.max(0, Math.round(Number(reply?.rcount) || 0)),
    published: Number.isFinite(ctime) && ctime > 0 ? new Date(ctime * 1000).toISOString() : '',
  };
}

/** Merge pinned + hot replies, drop duplicates/empties, best-liked first. */
export function readReplyPage(data) {
  const raw = [];
  for (const bucket of [data?.top_replies, data?.top, data?.replies]) {
    if (Array.isArray(bucket)) raw.push(...bucket);
  }
  const seen = new Set();
  const out = [];
  for (const reply of raw) {
    const item = normalizeReply(reply);
    if (item.text === '') continue;
    const key = item.id || `${item.author}\u0000${item.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out.sort((a, b) => b.likes - a.likes);
}

export function parseReplyCount(data) {
  const value = Number(data?.count);
  return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
}

/**
 * Comment count (and optionally hot comments) for one video.
 * Never throws: a block (-352/-412), a deleted video or a network error comes
 * back as `{ error }` and the caller keeps the title it already had.
 */
export async function fetchVideoComments(
  aid,
  { getJson, storeDir, withComments = true, maxComments = 4, cacheMs = COMMENT_CACHE_MS, force = false } = {},
) {
  const id = Number(aid);
  if (!Number.isFinite(id) || id <= 0) return { aid, commentCount: null, comments: [], bytes: 0, elapsedMs: 0 };
  const file = cachePath(storeDir, id);
  const cached = force ? null : readCache(file);
  const fresh = cached && Date.now() - Number(cached.at || 0) < cacheMs;
  // A count-only lookup must not satisfy a later "give me the replies" call.
  const hasComments = cached && (cached.full === true || (Array.isArray(cached.comments) && cached.comments.length > 0));
  if (fresh && Number.isFinite(Number(cached.commentCount)) && (!withComments || hasComments)) {
    const comments = withComments ? (cached.comments || []).slice(0, maxComments) : [];
    return { aid: id, commentCount: Number(cached.commentCount), comments, bytes: 0, elapsedMs: 0, cached: true };
  }

  const referer = `https://www.bilibili.com/video/av${id}`;
  let bytes = 0;
  let elapsedMs = 0;
  // A fresh cache still holding the count saves the count request when only the
  // replies are missing.
  let commentCount = fresh && Number.isFinite(Number(cached.commentCount)) ? Number(cached.commentCount) : null;
  let comments = [];

  if (commentCount === null) {
    try {
      const counted = await getJson(`https://api.bilibili.com/x/v2/reply/count?type=1&oid=${id}`, referer);
      bytes += counted.bytes || 0;
      elapsedMs += counted.elapsedMs || 0;
      commentCount = parseReplyCount(counted.data);
    } catch (error) {
      return {
        aid: id,
        commentCount: cached ? Number(cached.commentCount) : null,
        comments: cached?.comments || [],
        bytes,
        elapsedMs,
        error: error?.message || '评论数读取失败',
      };
    }
  }

  if (withComments && commentCount > 0) {
    try {
      const page = await getJson(
        `https://api.bilibili.com/x/v2/reply/main?type=1&oid=${id}&mode=3&next=0&ps=20`,
        referer,
      );
      bytes += page.bytes || 0;
      elapsedMs += page.elapsedMs || 0;
      comments = readReplyPage(page.data).slice(0, Math.max(1, Math.min(6, maxComments)));
    } catch {
      /* count is what ranks the video; comments are decoration */
    }
  }

  writeCache(file, { at: Date.now(), commentCount, comments, full: withComments && commentCount > 0 });
  return { aid: id, commentCount, comments, bytes, elapsedMs };
}

/**
 * Give a list of videos their comment counts and pick the most-discussed one.
 * Counts that the list payload already carries (space/ranking/view) cost no
 * request, so a ranking board usually needs exactly one extra call.
 */
export async function enrichBilibiliComments(list, options, context, getJson) {
  const items = Array.isArray(list) ? list : [];
  const requested = Number(options?.commentScan ?? COMMENT_SCAN_DEFAULT);
  const scanLimit =
    options?.comments === false
      ? 0
      : Math.max(
          0,
          Math.min(items.length, Number.isFinite(requested) ? requested : COMMENT_SCAN_DEFAULT, COMMENT_SCAN_MAX),
        );
  if (scanLimit === 0) return { items, featured: null, bytes: 0, note: '' };

  let bytes = 0;
  let failures = 0;
  const scanned = await mapLimit(items.slice(0, scanLimit), COMMENT_CONCURRENCY, async (item) => {
    if (Number(item.commentCount) > 0) return item;
    const aid = Number(item.aid);
    if (!Number.isFinite(aid) || aid <= 0) return item;
    const stats = await fetchVideoComments(aid, { getJson, storeDir: context.storeDir, withComments: false });
    bytes += stats.bytes || 0;
    if (stats.error) failures += 1;
    if (Number.isFinite(stats.commentCount) && stats.commentCount > 0) {
      item.commentCount = Math.round(stats.commentCount);
    }
    return item;
  });

  const ranked = scanned.filter((item) => Number(item.commentCount) > 0).sort((a, b) => b.commentCount - a.commentCount);
  if (ranked.length === 0) {
    return { items, featured: null, bytes, note: failures > 0 ? '评论数暂时读不到' : '' };
  }

  const best = ranked[0];
  const requestedComments = Number(options?.commentsPerVideo ?? 4);
  const perVideo = Math.max(1, Math.min(6, Number.isFinite(requestedComments) ? requestedComments : 4));
  const full = await fetchVideoComments(Number(best.aid), {
    getJson,
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
      meta: best.meta ?? 'B 站',
      commentCount: best.commentCount,
      comments,
    },
    bytes,
    note: `评论最多：${truncate(best.title, 60)}（${best.commentCount} 条）`,
  };
}
