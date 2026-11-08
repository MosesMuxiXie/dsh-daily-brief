/**
 * Generic JSON collector with a tiny dot-path mapping.
 *
 * The import wizard guesses the array path and the title/url/date fields; the
 * user can correct them in the per-source editor.
 */
import { safeFetch } from '../fetch.js';
import { truncate, absoluteUrl, stripHtml } from '../text.js';

export function getByPath(value, path) {
  if (typeof path !== 'string' || path === '') return value;
  let current = value;
  for (const part of path.split('.')) {
    if (part === '') continue;
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (current && typeof current === 'object') {
      current = current[part];
    } else {
      return undefined;
    }
  }
  return current;
}

function scalar(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function urlFrom(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    for (const key of ['url', 'href', 'link', 'permalink', '@_href', 'web_url']) {
      if (typeof value[key] === 'string') return value[key];
    }
  }
  return '';
}

export function guessJsonMapping(value) {
  const fallback = { items: 'items', title: 'title', url: 'url', date: 'date', summary: 'summary' };
  const queue = [{ node: value, path: '' }];
  let candidate = null;
  for (let depth = 0; queue.length > 0 && depth < 400; depth += 1) {
    const { node, path: base } = queue.shift();
    if (Array.isArray(node) && node.length > 0 && node.some((entry) => entry && typeof entry === 'object')) {
      const sample = node.find((entry) => entry && typeof entry === 'object');
      const keys = Object.keys(sample ?? {});
      const titleKey = keys.find((key) => /^(title|name|headline|subject|label)$/i.test(key));
      if (titleKey) {
        candidate = {
          items: base || 'items',
          title: titleKey,
          url: keys.find((key) => /^(url|link|href|permalink|web_url)$/i.test(key)) ?? 'url',
          date: keys.find((key) => /^(date|published|published_at|created_at|pubDate|updated|time)$/i.test(key)) ?? 'date',
          summary: keys.find((key) => /^(summary|description|content|contents|excerpt|body|text)$/i.test(key)) ?? 'summary',
        };
        break;
      }
    }
    if (node && typeof node === 'object' && !Array.isArray(node)) {
      for (const [key, child] of Object.entries(node)) {
        if (child && typeof child === 'object') {
          queue.push({ node: child, path: base === '' ? key : `${base}.${key}` });
        }
      }
    }
  }
  return candidate ?? fallback;
}

export async function collectJson(source, context = {}) {
  const response = await safeFetch(source.url, { headers: context.headers, timeoutMs: 20000 });
  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    throw new Error('返回内容不是有效 JSON');
  }
  const mapping = source.options.mapping ?? guessJsonMapping(parsed);
  let list = getByPath(parsed, mapping.items);
  if (!Array.isArray(list)) {
    if (Array.isArray(parsed)) list = parsed;
    else if (list && typeof list === 'object') list = [list];
    else list = [];
  }
  const baseUrl = response.finalUrl;
  const cutoff = Date.now() - (source.options.sinceHours ?? 24) * 3600000;
  const items = [];
  for (const entry of list.slice(0, 200)) {
    if (entry === null || typeof entry !== 'object') continue;
    const title = truncate(scalar(getByPath(entry, mapping.title)), 180);
    if (title === '') continue;
    const url = absoluteUrl(urlFrom(getByPath(entry, mapping.url)), baseUrl);
    const rawDate = scalar(getByPath(entry, mapping.date));
    let date = '';
    if (rawDate !== '') {
      const numeric = /^\d+$/.test(rawDate) ? Number(rawDate) : NaN;
      const parsed = Number.isFinite(numeric) && numeric < 1e12 ? new Date(numeric * 1000) : new Date(rawDate);
      if (!Number.isNaN(parsed.getTime())) date = parsed.toISOString();
    }
    if (date !== '' && new Date(date).getTime() < cutoff) continue;
    items.push({
      id: `${url || title}`.slice(0, 300),
      title,
      url,
      detail: truncate(stripHtml(scalar(getByPath(entry, mapping.summary))).replace(/^[\\•\s]+/, ''), 190),
      date,
      meta: '',
      badge: '',
      tone: '',
    });
    if (items.length >= (source.options.limit ?? 8) * 2) break;
  }
  items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return {
    items: items.slice(0, source.options.limit ?? 8),
    note: `共 ${list.length} 条记录`,
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}
