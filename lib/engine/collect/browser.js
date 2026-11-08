/**
 * Local browser footprint: history + bookmarks of installed Chrome/Edge
 * profiles. All reads happen on temp copies so a running browser is never
 * locked and the original SQLite files are never touched.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { hostOf, truncate } from '../text.js';

const CHROME_EPOCH_OFFSET_MS = 11644473600000;
const SKIP_URL = /^(chrome|edge|about|devtools|file|view-source):/i;
const SKIP_SEARCH = /(google|bing|baidu|duckduckgo|yandex)\.(com|cn|ru)\/(search|s\?)/i;

function chromeTimeToMs(value) {
  const micros = Number(value);
  if (!Number.isFinite(micros) || micros <= 0) return 0;
  return Math.round(micros / 1000 - CHROME_EPOCH_OFFSET_MS);
}

function localAppData() {
  return process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
}

const BROWSERS = {
  edge: () => path.join(localAppData(), 'Microsoft', 'Edge', 'User Data'),
  chrome: () => path.join(localAppData(), 'Google', 'Chrome', 'User Data'),
};

function profileDirs(userDataDir) {
  const dirs = [];
  for (const name of ['Default', 'Profile 1', 'Profile 2', 'Profile 3', 'Profile 4']) {
    const dir = path.join(userDataDir, name);
    if (fs.existsSync(path.join(dir, 'History')) || fs.existsSync(path.join(dir, 'Bookmarks'))) dirs.push(dir);
  }
  return dirs;
}

function withTempCopy(sourceFile, callback) {
  const tempDir = path.join(os.tmpdir(), `dsh-db-${randomUUID()}`);
  fs.mkdirSync(tempDir, { recursive: true });
  const target = path.join(tempDir, 'History');
  try {
    fs.copyFileSync(sourceFile, target);
    for (const suffix of ['-wal', '-shm']) {
      if (fs.existsSync(`${sourceFile}${suffix}`)) fs.copyFileSync(`${sourceFile}${suffix}`, `${target}${suffix}`);
    }
    return callback(target);
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* temp cleanup is best effort */
    }
  }
}

function readHistory(dbFile, sinceMs, limit) {
  return withTempCopy(dbFile, (copy) => {
    const db = new DatabaseSync(copy, { readOnly: true });
    try {
      const rows = db
        .prepare(
          'SELECT url, title, last_visit_time AS visited, visit_count AS visits FROM urls ' +
            'WHERE last_visit_time > ? ORDER BY last_visit_time DESC LIMIT ?',
        )
        .all(Math.round((sinceMs + CHROME_EPOCH_OFFSET_MS) * 1000), limit * 4);
      return rows.map((row) => ({
        url: String(row.url ?? ''),
        title: truncate(String(row.title ?? ''), 160),
        date: new Date(chromeTimeToMs(row.visited)).toISOString(),
        visits: Number(row.visits ?? 0),
        kind: 'history',
      }));
    } finally {
      db.close();
    }
  });
}

function flattenBookmarks(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'url' && typeof node.url === 'string') {
    out.push({ url: node.url, title: truncate(String(node.name ?? ''), 160), kind: 'bookmark', date: '' });
  }
  if (Array.isArray(node.children)) for (const child of node.children) flattenBookmarks(child, out);
}

function readBookmarks(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = [];
    for (const root of Object.values(data.roots ?? {})) flattenBookmarks(root, out);
    return out;
  } catch {
    return [];
  }
}

export async function collectBrowser(source, context = {}) {
  const started = Date.now();
  const sinceMs = Date.now() - (source.options.sinceHours ?? 24) * 3600000;
  const limit = source.options.limit ?? 8;
  const wanted = source.options.browsers ?? ['edge', 'chrome'];
  const items = [];
  const sources = [];
  for (const name of wanted) {
    const resolve = BROWSERS[name];
    if (!resolve) continue;
    const userDataDir = resolve();
    if (!fs.existsSync(userDataDir)) continue;
    for (const profileDir of profileDirs(userDataDir)) {
      const historyFile = path.join(profileDir, 'History');
      if (fs.existsSync(historyFile)) {
        try {
          const rows = readHistory(historyFile, sinceMs, limit);
          for (const row of rows) items.push({ ...row, meta: `${name === 'edge' ? 'Edge' : 'Chrome'} 历史` });
          sources.push(`${name}:${path.basename(profileDir)}`);
        } catch {
          /* one locked/corrupt profile must not hide the others */
        }
      }
      const bookmarkFile = path.join(profileDir, 'Bookmarks');
      if (fs.existsSync(bookmarkFile)) {
        for (const row of readBookmarks(bookmarkFile)) items.push({ ...row, meta: `${name === 'edge' ? 'Edge' : 'Chrome'} 书签` });
      }
    }
  }
  const now = Date.now();
  const seen = new Set();
  const cleaned = items
    .filter((item) => /^https?:\/\//i.test(item.url) && !SKIP_URL.test(item.url) && !SKIP_SEARCH.test(item.url) && item.title.length >= 2)
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      if (item.date && now - new Date(item.date).getTime() > (source.options.sinceHours ?? 24) * 3600000 * 2) return false;
      return true;
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, limit)
    .map((item) => ({
      id: item.url.slice(0, 300),
      title: item.title,
      url: item.url,
      detail: item.kind === 'bookmark' ? '书签' : `最近访问 ${item.visits ?? 1} 次`,
      date: item.date,
      meta: item.meta,
      badge: item.kind === 'bookmark' ? '书签' : '',
      tone: '',
    }));
  return {
    items: cleaned,
    status: cleaned.length > 0 ? 'ok' : 'skipped',
    note: cleaned.length > 0 ? sources.slice(0, 4).join(' · ') : '没有可读取的浏览器数据',
    elapsedMs: Date.now() - started,
  };
}

export function browserPathsForTest() {
  return BROWSERS;
}

export function hostOfUrlForTest(url) {
  return hostOf(url);
}
