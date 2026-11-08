/**
 * HTML page watcher: feed autodiscovery is preferred by the importer, this
 * collector handles pages that only expose links. A CSS selector is optional;
 * the fallback heuristic keeps article-like links in document order.
 */
import { parse } from 'node-html-parser';
import { safeFetch } from '../fetch.js';
import { readSourceHeaders } from '../secrets.js';
import { absoluteUrl, hostOf, stripHtml, truncate } from '../text.js';

export function discoverFeeds(html, baseUrl) {
  const root = parse(String(html ?? ''));
  const links = root.querySelectorAll('link[rel~="alternate"]');
  const feeds = [];
  for (const link of links) {
    const type = (link.getAttribute('type') ?? '').toLowerCase();
    const href = link.getAttribute('href') ?? '';
    if (!/application\/(rss|atom)\+xml/.test(type) || href === '') continue;
    const url = absoluteUrl(href, baseUrl);
    if (url !== '') feeds.push({ url, title: link.getAttribute('title') ?? '' });
  }
  return feeds;
}

const NAV_WORDS = /(登录|注册|sign in|log in|privacy|terms|cookie|about|contact|advertise|subscribe|newsletter|首页|关于|联系)/i;

export function extractLinks(html, baseUrl, options = {}) {
  const root = parse(String(html ?? ''));
  const nodes = options.selector ? root.querySelectorAll(options.selector) : root.querySelectorAll('a');
  const items = [];
  const seen = new Set();
  const baseHost = hostOf(baseUrl);
  for (const node of nodes) {
    const anchor = node.tagName === 'A' ? node : node.querySelector('a') ?? node;
    const href = anchor.getAttribute('href') ?? '';
    const url = absoluteUrl(href, baseUrl);
    if (url === '' || seen.has(url)) continue;
    const title = truncate(stripHtml(anchor.textContent ?? ''), 180);
    if (title.length < 6 || NAV_WORDS.test(title)) continue;
    const host = hostOf(url);
    if (!options.selector && baseHost !== '' && host !== '' && host !== baseHost && !options.allowExternal) continue;
    const container = anchor.closest('article, li, section, div');
    const time = container?.querySelector('time');
    const date = time?.getAttribute('datetime') ?? '';
    seen.add(url);
    items.push({
      id: url.slice(0, 300),
      title,
      url,
      detail: '',
      date: date && !Number.isNaN(new Date(date).getTime()) ? new Date(date).toISOString() : '',
      meta: host,
      badge: '',
      tone: '',
    });
    if (items.length >= 120) break;
  }
  return items;
}

export async function collectPage(source, context = {}) {
  // A saved Cookie/header set lets the same collector read school portals and
  // signed-in workspaces (ManageBac, Feishu, internal dashboards).
  const savedHeaders = context.storeDir ? await readSourceHeaders(context.storeDir, source.id) : {};
  const headers = { ...(context.headers || {}), ...(savedHeaders || {}) };
  const response = await safeFetch(source.url, { headers, timeoutMs: 20000 });
  let items = extractLinks(response.text, response.finalUrl, {
    selector: source.options.selector || undefined,
    allowExternal: false,
  });
  const keyword = String(source.options.keyword || '').trim().toLowerCase();
  if (keyword !== '') {
    items = items.filter((item) => `${item.title} ${item.meta}`.toLowerCase().includes(keyword));
  }
  const cutoff = Date.now() - (source.options.sinceHours ?? 24) * 3600000;
  const dated = items.filter((item) => item.date !== '');
  if (dated.length > 0) {
    const recent = items.filter((item) => item.date === '' || new Date(item.date).getTime() >= cutoff);
    if (recent.length > 0) items = recent;
  }
  return {
    items: items.slice(0, source.options.limit ?? 8),
    note: items.length === 0 ? '页面中没有找到可识别的条目，可尝试设置 CSS 选择器' : `页面共 ${items.length} 个链接`,
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}
