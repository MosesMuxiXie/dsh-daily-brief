/**
 * Bilibili collector — public web APIs, no login required.
 *
 * The space API is WBI-signed: bilibili hashes a sorted query with a per-day
 * mixin key derived from `/x/web-interface/nav`. A `buvid3` cookie from
 * `/x/frontend/finger/spi` makes the first request look like a normal browser;
 * without it the endpoint often answers -352 (风控). Single videos and the
 * ranking board need neither.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeFetch } from '../fetch.js';
import { readSourceHeaders } from '../secrets.js';
import { truncate, stripHtml } from '../text.js';
import { commentCountFromVideo, enrichBilibiliComments } from './bilibili-comments.js';

const NAV_CACHE_MS = 6 * 3600 * 1000;
const ITEMS_CACHE_MS = 8 * 60 * 1000;
const MIN_GAP_MS = 400;
const MIXIN_ORDER = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20,
  34, 44, 52,
];

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

let lastRequestAt = 0;

function cachePath(storeDir, key) {
  if (!storeDir) return '';
  return path.join(storeDir, '.cache', `bilibili-${key}.json`);
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

async function gap() {
  const wait = lastRequestAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('B 站接口返回的不是 JSON（可能被拦截或需要登录）');
  }
}

function biliError(data) {
  const code = Number(data?.code);
  if (code === -352 || code === -412) {
    return 'B 站接口触发风控（-352/-412），本次先跳过；可以稍后重试，或改用单条视频链接。';
  }
  if (code === -799) return 'B 站接口限流（-799），请稍后重试。';
  if (code === -101) return 'B 站接口要求登录（-101），暂时读不到这个空间。';
  if (code === -404) return 'B 站视频不存在或已删除。';
  return `B 站接口返回 ${Number.isFinite(code) ? code : '未知'}：${data?.message || '未知错误'}`;
}

// B 站风控按 IP 计费：一旦答 -412，同一轮里再敲十几次只会把封禁时间拖长。
// 命中后进入冷却，后续请求直接短路；列表类请求可用 bypassRiskCooldown 再试一次。
let riskUntil = 0;
const RISK_COOLDOWN_MS = 10 * 60 * 1000;

function isRiskError(error) {
  return /-(352|412|799)|风控|限流|冷却/.test(String(error?.message || ''));
}

async function biliJson(url, storeDir, referer, source, options = {}) {
  if (options.bypassRiskCooldown !== true && Date.now() < riskUntil) {
    throw new Error('B 站接口仍在风控冷却中，本次跳过');
  }
  await gap();
  const cookie = await buvidCookie(storeDir);
  // A saved Cookie request header lets users read spaces that would otherwise
  // answer -352 (风控) to a cold request.
  const saved = source?.id ? await readSourceHeaders(storeDir, source.id) : null;
  const response = await safeFetch(url, {
    timeoutMs: 20000,
    headers: {
      'user-agent': UA,
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9',
      referer: referer || 'https://www.bilibili.com/',
      ...(cookie ? { cookie } : {}),
      ...(saved || {}),
    },
  });
  const data = parseJson(response.text);
  if (Number(data?.code) === -412) riskUntil = Date.now() + RISK_COOLDOWN_MS;
  if (Number(data?.code) !== 0) throw new Error(biliError(data));
  return { data: data.data, bytes: response.bytes, elapsedMs: response.elapsedMs };
}

async function buvidCookie(storeDir) {
  const file = cachePath(storeDir, 'buvid');
  const cached = readCache(file);
  if (cached && cached.value && Date.now() - Number(cached.at || 0) < NAV_CACHE_MS) {
    return cached.value;
  }
  try {
    const response = await safeFetch('https://api.bilibili.com/x/frontend/finger/spi', {
      timeoutMs: 15000,
      headers: { 'user-agent': UA, accept: 'application/json', referer: 'https://www.bilibili.com/' },
    });
    const data = parseJson(response.text)?.data || {};
    const parts = [];
    if (data.b_3) parts.push(`buvid3=${data.b_3}`);
    if (data.b_4) parts.push(`buvid4=${data.b_4}`);
    const value = parts.join('; ');
    if (value !== '') writeCache(file, { value, at: Date.now() });
    return value;
  } catch {
    return '';
  }
}

async function wbiKeys(storeDir) {
  const file = cachePath(storeDir, 'wbi');
  const cached = readCache(file);
  if (cached && cached.mixin && Date.now() - Number(cached.at || 0) < NAV_CACHE_MS) {
    return cached;
  }
  const response = await safeFetch('https://api.bilibili.com/x/web-interface/nav', {
    timeoutMs: 15000,
    headers: {
      'user-agent': UA,
      accept: 'application/json',
      referer: 'https://www.bilibili.com/',
      ...(await buvidCookie(storeDir).then((cookie) => (cookie ? { cookie } : {}))),
    },
  });
  const image = parseJson(response.text)?.data?.wbi_img || {};
  const name = (value) => String(value || '').split('/').pop()?.split('.')[0] || '';
  const raw = `${name(image.img_url)}${name(image.sub_url)}`;
  if (raw.length < 32) throw new Error('B 站没有返回 WBI 签名密钥，空间接口暂时不可用');
  const mixin = MIXIN_ORDER.map((index) => raw[index] || '').join('').slice(0, 32);
  const value = { mixin, at: Date.now() };
  writeCache(file, value);
  return value;
}

function signQuery(params, mixin) {
  const all = { ...params, wts: Math.round(Date.now() / 1000) };
  const query = Object.keys(all)
    .sort()
    .map((key) => {
      const value = String(all[key] ?? '').replace(/[!'()*]/g, '');
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join('&');
  const rid = crypto.createHash('md5').update(query + mixin).digest('hex');
  return `${query}&w_rid=${rid}`;
}

/** Parse space / video / short-link / ranking URLs. */
export function parseBilibiliUrl(raw) {
  const input = String(raw || '').trim();
  if (input === '') return null;
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  if (host === 'b23.tv') return { mode: 'short', shortUrl: url.href };
  if (!/(^|\.)bilibili\.com$/.test(host)) return null;

  if (host === 'space.bilibili.com') {
    const mid = url.pathname.split('/').filter(Boolean)[0] || '';
    return /^\d+$/.test(mid) ? { mode: 'space', mid } : null;
  }
  const video = /^\/video\/(BV[0-9A-Za-z]{10})/i.exec(url.pathname);
  if (video) return { mode: 'video', bvid: video[1] };
  const av = /^\/video\/av(\d+)/i.exec(url.pathname);
  if (av) return { mode: 'video', aid: av[1] };
  if (/^\/v\/popular\/rank/.test(url.pathname)) return { mode: 'ranking' };
  return null;
}

function itemFromVideo(video, authorFallback = '') {
  const bvid = String(video?.bvid || '');
  const created = Number(video?.created || video?.pubdate || 0);
  const date = created > 0 ? new Date(created * 1000).toISOString() : '';
  const author = String(video?.owner?.name || video?.author || authorFallback || '').trim();
  const description = String(video?.desc || video?.description || '').trim();
  const aid = Number(video?.aid || 0);
  const commentCount = commentCountFromVideo(video);
  return {
    id: (`bilibili-${bvid || video?.aid || video?.title || ''}`).slice(0, 300),
    title: truncate(stripHtml(video?.title || ''), 180),
    url: bvid ? `https://www.bilibili.com/video/${bvid}` : String(video?.short_link_v2 || ''),
    detail: truncate(stripHtml(description || (author ? `UP：${author}` : '')), 190),
    date,
    meta: author || 'B 站',
    badge: 'B站',
    tone: '',
    // aid stays on the item so the comment pass can ask about exactly the
    // videos it shows; normalizeItem() drops it again before rendering.
    ...(Number.isFinite(aid) && aid > 0 ? { aid } : {}),
    ...(commentCount > 0 ? { commentCount } : {}),
  };
}

async function collectSpace(mid, source, context) {
  try {
    return await collectSpaceArchive(mid, source, context);
  } catch (error) {
    // 空间接口在限流时也会用「空列表」冒充成功，所以「没有公开视频」也要再试一次。
    if (!isUnavailable(error)) throw error;
    try {
      return await collectSpaceDynamic(mid, source, context);
    } catch (fallback) {
      if (!isUnavailable(fallback)) throw fallback;
      throw new Error('B 站空间暂时读不到（本机 IP 被限流 -412，或该 UP 没有公开投稿）：限流通常 5–30 分钟恢复；也可以先改用单条视频链接，或给该来源补填浏览器 Cookie。');
    }
  }
}

/** 限流与「读不到」都值得换条路再试；真正的配置错误不该被吞掉。 */
function isUnavailable(error) {
  const message = String(error?.message || '');
  return isRiskError(error) || /没有公开视频|读不到/.test(message);
}

async function collectSpaceArchive(mid, source, context) {
  const limit = source.options.limit ?? 8;
  const keys = await wbiKeys(context.storeDir);
  const query = signQuery(
    { mid, ps: Math.min(limit, 30), pn: 1, order: 'pubdate', platform: 'web', web_location: 1550101 },
    keys.mixin,
  );
  const { data, bytes, elapsedMs } = await biliJson(
    `https://api.bilibili.com/x/space/wbi/arc/search?${query}`,
    context.storeDir,
    `https://space.bilibili.com/${mid}`,
    source,
    { bypassRiskCooldown: true },
  );
  const list = data?.list?.vlist || [];
  if (list.length === 0) throw new Error('这个 B 站空间暂时没有公开视频');
  const name = String(list[0]?.author || '').trim();
  return {
    items: list.map((video) => itemFromVideo(video, name)).filter((item) => item.title !== ''),
    note: name ? `来自 ${name} 的 B 站投稿` : 'B 站 UP 主更新',
    bytes,
    elapsedMs,
  };
}

/** 动态接口里的投稿（DYNAMIC_TYPE_AV）摊平成视频对象。 */
function dynamicVideos(data) {
  const entries = Array.isArray(data?.items) ? data.items : [];
  const videos = [];
  for (const entry of entries) {
    if (String(entry?.type || '') !== 'DYNAMIC_TYPE_AV') continue;
    const archive = entry?.modules?.module_dynamic?.major?.archive;
    if (!archive?.bvid) continue;
    const published = Number(archive.pubdate || entry?.modules?.module_author?.pub_ts || 0);
    videos.push({
      ...archive,
      created: published,
      owner: { name: String(entry?.modules?.module_author?.name || '') },
    });
  }
  return videos;
}

async function collectSpaceDynamic(mid, source, context) {
  const limit = Math.min(source.options.limit ?? 8, 12);
  const cutoff = Date.now() - (source.options.sinceHours ?? 24) * 3600000;
  let offset = '';
  let bytes = 0;
  let elapsedMs = 0;
  const videos = [];
  for (let page = 0; page < 3; page += 1) {
    const suffix = offset === '' ? '' : `&offset=${encodeURIComponent(offset)}`;
    const { data, bytes: size, elapsedMs: spent } = await biliJson(
      `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?host_mid=${encodeURIComponent(mid)}&timezone_offset=-480&features=itemOpusStyle${suffix}`,
      context.storeDir,
      `https://space.bilibili.com/${mid}/dynamic`,
      source,
      { bypassRiskCooldown: true },
    );
    bytes += size;
    elapsedMs += spent;
    videos.push(...dynamicVideos(data));
    const next = data?.offset;
    if (data?.has_more !== true || !next || String(next) === offset) break;
    offset = String(next);
    const oldest = videos.reduce((min, video) => Math.min(min, Number(video.created) * 1000 || Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
    if (videos.length >= limit * 2 || oldest < cutoff) break;
  }
  if (videos.length === 0) throw new Error('这个 B 站空间暂时没有公开视频');
  const name = String(videos[0]?.owner?.name || '').trim();
  return {
    items: videos.map((video) => itemFromVideo(video, name)).filter((item) => item.title !== ''),
    note: name ? `来自 ${name} 的 B 站投稿` : 'B 站 UP 主更新',
    bytes,
    elapsedMs,
  };
}

async function collectVideo(source, parsed, context) {
  let bvid = String(source.options.bvid || parsed.bvid || '').trim();
  let aid = String(parsed.aid || '').trim();
  if (bvid === '' && aid !== '') {
    const resolved = await biliJson(
      `https://api.bilibili.com/x/web-interface/view?aid=${encodeURIComponent(aid)}`,
      context.storeDir,
      'https://www.bilibili.com/',
      source,
    );
    bvid = String(resolved.data?.bvid || '');
    return {
      items: [itemFromVideo(resolved.data)].filter((item) => item.title !== ''),
      note: 'B 站视频',
      bytes: resolved.bytes,
      elapsedMs: resolved.elapsedMs,
    };
  }
  if (!/^BV[0-9A-Za-z]{10}$/i.test(bvid)) throw new Error('这不是有效的 B 站视频链接');
  const { data, bytes, elapsedMs } = await biliJson(
    `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
    context.storeDir,
    `https://www.bilibili.com/video/${bvid}`,
    source,
  );
  return {
    items: [itemFromVideo(data)].filter((item) => item.title !== ''),
    note: 'B 站视频',
    bytes,
    elapsedMs,
  };
}

async function collectRanking(source, context) {
  const { data, bytes, elapsedMs } = await biliJson(
    'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all',
    context.storeDir,
    'https://www.bilibili.com/v/popular/rank/all',
    source,
  );
  const list = (data?.list || []).slice(0, source.options.limit ?? 8);
  if (list.length === 0) throw new Error('B 站排行榜暂时没有数据');
  return {
    items: list.map((video) => itemFromVideo(video)).filter((item) => item.title !== ''),
    note: 'B 站全站排行榜',
    bytes,
    elapsedMs,
  };
}

async function resolveShortLink(shortUrl) {
  const response = await safeFetch(shortUrl, { timeoutMs: 15000, headers: { 'user-agent': UA } });
  return parseBilibiliUrl(response.finalUrl) || null;
}

export async function collectBilibili(source, context = {}) {
  const options = source.options || {};
  let parsed = parseBilibiliUrl(source.url);
  if (parsed?.mode === 'short') parsed = await resolveShortLink(parsed.shortUrl);
  if (!parsed && (options.bvid || options.mid || options.mode === 'ranking')) {
    if (options.bvid) parsed = { mode: 'video', bvid: String(options.bvid) };
    else if (options.mid) parsed = { mode: 'space', mid: String(options.mid) };
    else parsed = { mode: 'ranking' };
  }
  if (!parsed) throw new Error('这不是有效的 B 站链接（支持视频、UP 主空间、b23.tv 短链与排行榜）');

  const mode = options.bvid ? 'video' : options.mid ? 'space' : parsed.mode;
  const key = safeKey(`${mode}-${parsed.bvid || parsed.mid || 'rank'}-${options.limit ?? 8}`);
  const file = cachePath(context.storeDir, `items-${key}`);
  const cached = readCache(file);
  if (cached && Date.now() - Number(cached.at || 0) < ITEMS_CACHE_MS) return cached.value;

  let result;
  if (mode === 'space') {
    try {
      result = await collectSpace(String(options.mid || parsed.mid), source, context);
    } catch (error) {
      // 空间接口限流时，宁可端出上次读到的投稿，也不要让整个来源当天消失。
      const stale = readCache(file);
      const items = stale?.value?.items || [];
      if (isUnavailable(error) && items.length > 0) {
        return {
          ...stale.value,
          note: [stale.value.note, '接口限流，沿用上次缓存'].filter(Boolean).join(' · '),
        };
      }
      throw error;
    }
  } else if (mode === 'ranking') {
    result = await collectRanking(source, context);
  } else {
    result = await collectVideo(source, parsed, context);
  }
  const cutoff = Date.now() - (options.sinceHours ?? 24) * 3600000;
  const fresh = result.items.filter((item) => {
    if (!item.date) return true;
    return new Date(item.date).getTime() >= cutoff;
  });
  if (fresh.length > 0 && mode === 'space') result = { ...result, items: fresh.slice(0, options.limit ?? 8) };

  // Same treatment as YouTube: count every video on the card, then keep the
  // most-discussed one as the day's featured card with its hottest replies.
  const enriched = await enrichBilibiliComments(result.items, options, context, (url, referer) =>
    biliJson(url, context.storeDir, referer, source),
  );
  if (enriched.featured || enriched.note) {
    result = {
      ...result,
      items: enriched.items,
      bytes: (result.bytes || 0) + (enriched.bytes || 0),
      ...(enriched.featured ? { featured: enriched.featured } : {}),
      ...(enriched.note ? { note: [result.note, enriched.note].filter(Boolean).join(' · ') } : {}),
    };
  }

  writeCache(file, { value: result, at: Date.now() });
  return result;
}
