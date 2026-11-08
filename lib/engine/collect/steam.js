/**
 * Steam news collector for one watched game (appid).
 *
 * Steam's news endpoint is occasionally unreachable (connection reset), so the
 * last successful response is cached and reused with an explicit note instead
 * of failing the whole briefing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { safeFetch } from '../fetch.js';
import { firstSentence, stripHtml, truncate } from '../text.js';

function cacheFile(storeDir, appid) {
  return path.join(storeDir, '.cache', `steam-${appid}.json`);
}

function readCache(storeDir, appid) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(storeDir, appid), 'utf8'));
  } catch {
    return null;
  }
}

function writeCache(storeDir, appid, payload) {
  try {
    const file = cacheFile(storeDir, appid);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
  } catch {
    /* cache is best effort */
  }
}

function toItem(entry, source) {
  const title = truncate(String(entry.title || '').replace(/\s+/g, ' ').trim(), 140);
  if (title === '') return null;
  const detail = firstSentence(stripHtml(entry.contents || ''), 180);
  const date = Number(entry.date) > 0 ? new Date(Number(entry.date) * 1000).toISOString() : '';
  const label = source.label || `Steam ${source.options?.appid}`;
  return {
    id: `steam-${entry.gid || `${source.options?.appid}-${entry.date}`}`,
    title,
    detail,
    url: typeof entry.url === 'string' ? entry.url : '',
    date,
    meta: entry.author && entry.author !== '' ? `${label} · ${truncate(entry.author, 40)}` : label,
    badge: '',
    tone: '',
  };
}

export async function collectSteam(source, context = {}) {
  const started = Date.now();
  const appid = Number(source.options?.appid) || 0;
  if (appid <= 0) return { status: 'error', items: [], note: '没有填写 Steam appid', elapsedMs: 0 };
  const sinceHours = Number(source.options?.sinceHours) || 24 * 14;
  const limit = Number(source.options?.limit) || 3;
  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const storeDir = context.storeDir || '';
  const url = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${appid}&count=${Math.max(
    12,
    limit * 4,
  )}&maxlength=800&format=json`;

  let payload;
  let note = '';
  try {
    const response = await safeFetch(url, { timeoutMs: 20000, maxBytes: 4 * 1024 * 1024 });
    if (!response.ok) throw new Error(`Steam 返回 ${response.status}`);
    const data = JSON.parse(response.text);
    const entries = data?.appnews?.newsitems;
    if (!Array.isArray(entries)) throw new Error('Steam 新闻结构无法解析');
    payload = entries;
    writeCache(storeDir, appid, { at: new Date().toISOString(), entries });
  } catch (error) {
    const cached = readCache(storeDir, appid);
    if (cached?.entries?.length) {
      payload = cached.entries;
      note = 'Steam 暂时连不上，显示上次结果';
    } else {
      return {
        status: 'error',
        items: [],
        note: 'Steam 暂时连不上',
        elapsedMs: Date.now() - started,
      };
    }
  }

  const english = payload.filter((entry) => entry?.language === 0 || entry?.language === undefined);
  const pool = english.length > 0 ? english : payload;
  const items = pool
    .map((entry) => toItem(entry, source))
    .filter(Boolean)
    .filter((item) => {
      const time = new Date(item.date).getTime();
      return Number.isFinite(time) ? time >= cutoff : true;
    })
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);

  return {
    status: items.length > 0 ? 'ok' : 'skipped',
    items,
    note: items.length > 0 ? note : `${Math.round(sinceHours / 24)} 天内没有新公告`,
    elapsedMs: Date.now() - started,
  };
}
