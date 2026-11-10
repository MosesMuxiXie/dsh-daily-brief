/**
 * Generic web page collector.
 *
 * Two modes, chosen from the page itself:
 *  - article — read OpenGraph/JSON-LD and turn the page into one real entry;
 *  - listing — follow same-host links extracted from articles / cards.
 *
 * The listing mode keeps the CSS-selector escape hatch for sites that do not
 * expose semantic markup.
 */
import { parse } from 'node-html-parser';
import { safeFetch } from '../fetch.js';
import { readSourceHeaders } from '../secrets.js';
import { absoluteUrl, hostOf, stripHtml, truncate } from '../text.js';

const NAV_WORDS = /(登录|注册|sign in|log in|privacy|terms|cookie|about|contact|advertise|subscribe|newsletter|首页|关于|联系)/i;

export function discoverFeeds(html, baseUrl) {
  const root = parse(String(html ?? ''));
  const links = root.querySelectorAll('link');
  const found = [];
  for (const link of links) {
    const rel = (link.getAttribute('rel') || '').toLowerCase();
    const type = (link.getAttribute('type') || '').toLowerCase();
    if (!rel.includes('alternate')) continue;
    if (!/application\/(rss|atom)\+xml/.test(type)) continue;
    const href = absoluteUrl(link.getAttribute('href') || '', baseUrl);
    if (!href) continue;
    found.push({ url: href, title: (link.getAttribute('title') || '').trim() });
  }
  return found;
}

function metaContent(root, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const node of root.querySelectorAll('meta')) {
    const key = (node.getAttribute('property') || node.getAttribute('name') || '').toLowerCase();
    if (!wanted.has(key)) continue;
    const content = node.getAttribute('content');
    if (content && content.trim() !== '') return content.trim();
  }
  return '';
}

function firstSelector(root, selectors) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node) return node;
  }
  return null;
}

function toIso(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function firstParagraphs(root, limit = 2) {
  const body = firstSelector(root, [
    'article',
    'main',
    '[role="main"]',
    '.article-content',
    '.post-content',
    '.markdown-body',
    '.entry-content',
  ]);
  if (!body) return '';
  const paragraphs = body
    .querySelectorAll('p')
    .map((node) => stripHtml(node.textContent || ''))
    .filter((text) => text.length >= 20);
  return paragraphs.slice(0, limit).join(' ');
}

/**
 * Turn a single article/video page into one briefing item.
 * Returns null when the page has no usable title.
 */
export function extractArticle(html, baseUrl) {
  const root = parse(String(html ?? ''));
  const title = stripHtml(
    metaContent(root, ['og:title', 'twitter:title']) ||
      root.querySelector('h1')?.textContent ||
      root.querySelector('title')?.textContent ||
      '',
  ).replace(/\s+/g, ' ').trim();
  if (title.length < 4) return null;

  const canonical =
    metaContent(root, ['og:url']) ||
    root.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
    baseUrl;
  const url = absoluteUrl(canonical, baseUrl) || baseUrl;

  let date = toIso(
    metaContent(root, [
      'article:published_time',
      'article:modified_time',
      'datepublished',
      'date',
      'pubdate',
    ]),
  );
  if (date === '') {
    for (const node of root.querySelectorAll('script[type="application/ld+json"]')) {
      const match = /"datePublished"\s*:\s*"([^"]+)"/.exec(node.textContent || '');
      if (match) {
        date = toIso(match[1]);
        if (date !== '') break;
      }
    }
  }
  if (date === '') date = toIso(root.querySelector('time[datetime]')?.getAttribute('datetime') || '');

  let detail = stripHtml(
    metaContent(root, ['og:description', 'twitter:description', 'description']),
  );
  if (detail.length < 12) detail = firstParagraphs(root);
  if (detail.length < 12) {
    const body = firstSelector(root, ['article', 'main', '[role="main"]']);
    detail = stripHtml(body?.textContent || '').slice(0, 180);
  }

  return {
    id: url.slice(0, 300),
    title: truncate(title, 180),
    url,
    detail: truncate(detail.replace(/\s+/g, ' ').trim(), 190),
    date,
    meta: hostOf(url),
    badge: '',
    tone: '',
  };
}

/** Detect whether the page describes one article rather than a list. */
export function pageKind(html) {
  const root = parse(String(html ?? ''));
  const type = metaContent(root, ['og:type']).toLowerCase();
  if (type.includes('article') || type.startsWith('video')) return 'article';
  if (metaContent(root, ['article:published_time']) !== '') return 'article';
  if (root.querySelector('article') && root.querySelector('h1')) return 'article';
  return 'list';
}

export function extractLinks(html, baseUrl, options = {}) {
  const root = parse(String(html ?? ''));
  const nodes = options.selector ? root.querySelectorAll(options.selector) : root.querySelectorAll('a');
  const baseHost = hostOf(baseUrl);
  const items = [];
  const seen = new Set();
  for (const node of nodes) {
    const anchor = node.tagName === 'A' ? node : node.querySelector('a') ?? node;
    const href = anchor.getAttribute('href') || '';
    const url = absoluteUrl(href, baseUrl);
    if (!url || !/^https?:/i.test(url)) continue;
    const title = truncate(stripHtml(anchor.textContent || ''), 180);
    if (title.length < 6) continue;
    if (NAV_WORDS.test(title)) continue;
    if (!options.selector && !options.allowExternal && hostOf(url) !== baseHost) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const container = anchor.closest('article, li, section, div');
    const date = toIso(container?.querySelector('time')?.getAttribute('datetime') || '');
    items.push({
      id: url.slice(0, 300),
      title,
      url,
      detail: '',
      date,
      meta: hostOf(url),
      badge: '',
      tone: '',
    });
    if (items.length >= 120) break;
  }
  return items;
}

function keywordFilter(items, keyword) {
  if (!keyword) return items;
  const needle = String(keyword).toLowerCase();
  return items.filter((item) => `${item.title} ${item.detail}`.toLowerCase().includes(needle));
}

function dateFilter(items, sinceHours, isArticle) {
  if (isArticle) return items;
  const cutoff = Date.now() - (sinceHours ?? 24) * 3600000;
  if (!items.some((item) => item.date)) return items;
  const fresh = items.filter((item) => !item.date || new Date(item.date).getTime() >= cutoff);
  return fresh.length > 0 ? fresh : items;
}

export async function collectPage(source, context = {}) {
  const options = source.options || {};
  const savedHeaders = context.storeDir ? await readSourceHeaders(context.storeDir, source.id) : null;
  const response = await safeFetch(source.url, {
    timeoutMs: 20000,
    headers: savedHeaders || undefined,
  });
  const html = response.text;
  const kind = pageKind(html);
  let items = [];
  let note = '';
  let articleMode = false;

  if (options.selector) {
    items = extractLinks(html, source.url, {
      selector: options.selector,
      allowExternal: Boolean(options.allowExternal),
    });
    note = items.length > 0 ? `按选择器提取 ${items.length} 个条目` : '选择器没有匹配到条目';
  } else if (kind === 'article') {
    const article = extractArticle(html, source.url);
    if (article) {
      items = [article];
      articleMode = true;
      note = '已提取网页正文';
    }
  }

  if (items.length === 0 && !options.selector) {
    items = extractLinks(html, source.url, { allowExternal: false });
    if (items.length > 0) note = `页面共 ${items.length} 个可识别条目`;
  }
  if (items.length === 0) {
    const article = extractArticle(html, source.url);
    if (article) {
      items = [article];
      articleMode = true;
      note = '已提取网页正文';
    }
  }

  items = keywordFilter(items, options.keyword);
  items = dateFilter(items, options.sinceHours, articleMode);
  items = items.slice(0, options.limit ?? 8);

  if (items.length === 0) {
    note = '页面没有找到可识别的正文或条目，可以设置 CSS 选择器，或改用 RSS 订阅地址';
  }
  return {
    items,
    note,
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}
