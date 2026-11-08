/**
 * RSS 2.0 / Atom collector and parser.
 *
 * fast-xml-parser is namespace agnostic: we look for well-known tag names and
 * fall back to the first text-bearing child, which keeps feeds with `dc:`,
 * `content:`, `media:` or `a10:` prefixes readable.
 */
import { XMLParser } from 'fast-xml-parser';
import { safeFetch } from '../fetch.js';
import { stripHtml, truncate, absoluteUrl, hostOf } from '../text.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

export function parseFeedXml(xml) {
  const document = parser.parse(String(xml ?? ''));
  const rss = document?.rss;
  const rdf = document?.['rdf:RDF'];
  const atom = document?.feed;
  const channel = rss?.channel ?? rdf ?? atom ?? document;
  const entries = channel?.item ?? channel?.entry ?? rss?.item ?? [];
  const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
  const feedTitle = textOf(channel?.title) || textOf(atom?.title) || '';
  const items = list.map((entry) => normalizeEntry(entry)).filter((item) => item.title !== '');
  return { feedTitle, items };
}

function textOf(value, depth = 0) {
  if (value === null || value === undefined || depth > 4) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = textOf(item, depth + 1);
      if (text !== '') return text;
    }
    return '';
  }
  if (typeof value === 'object') {
    for (const key of ['#text', '__cdata', '@_href', '@_url', 'value']) {
      if (value[key] !== undefined) {
        const text = textOf(value[key], depth + 1);
        if (text !== '') return text;
      }
    }
    return '';
  }
  return '';
}

function firstDefined(object, keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined) return object[key];
  }
  return undefined;
}

function linkOf(entry) {
  const link = entry?.link;
  if (typeof link === 'string') return link;
  if (Array.isArray(link)) {
    const alternate = link.find((node) => node?.['@_rel'] === 'alternate' || node?.['@_rel'] === undefined);
    return alternate?.['@_href'] ?? textOf(alternate) ?? '';
  }
  if (link && typeof link === 'object') return link['@_href'] ?? textOf(link);
  return textOf(entry?.['atom:link']) || '';
}

function dateOf(entry) {
  const raw = firstDefined(entry, [
    'pubDate',
    'published',
    'updated',
    'dc:date',
    'a10:updated',
    'lastBuildDate',
  ]);
  const text = textOf(raw);
  if (text === '') return '';
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function cleanFeedDetail(raw) {
  const text = stripHtml(textOf(raw) || '');
  if (text === '') return '';
  // Hacker News RSS 把链接、热度、评论数塞进 description，直接显示会很脏。
  if (/Article URL:|Points:|Comments:/i.test(text)) {
    const points = /Points:\s*(\d+)/i.exec(text);
    const comments = /#?\s*Comments:\s*(\d+)/i.exec(text);
    const parts = [];
    if (points) parts.push(`${points[1]} 热度`);
    if (comments) parts.push(`${comments[1]} 评论`);
    if (parts.length) return parts.join(' · ');
    return '';
  }
  return truncate(text, 190);
}

function normalizeEntry(entry) {
  const title = truncate(stripHtml(textOf(firstDefined(entry, ['title', 'name']))), 180);
  const url = absoluteUrl(linkOf(entry), entry?.base);
  const summaryRaw = firstDefined(entry, [
    'description',
    'summary',
    'content',
    'content:encoded',
    'media:description',
  ]);
  const detail = cleanFeedDetail(summaryRaw);
  const date = dateOf(entry);
  const host = hostOf(url);
  return {
    id: `${url || title}`.slice(0, 300),
    title,
    url,
    detail,
    date,
    meta: host,
    badge: '',
    tone: '',
  };
}

export async function collectFeed(source, context = {}) {
  const response = await safeFetch(source.url, {
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 20000,
    headers: context.headers,
  });
  const { items, feedTitle } = parseFeedXml(response.text);
  const cutoff = Date.now() - (source.options.sinceHours ?? 24) * 3600000;
  const filtered = items.filter((item) => {
    if (!item.date) return true;
    return new Date(item.date).getTime() >= cutoff;
  });
  const trimmed = (filtered.length > 0 ? filtered : items).slice(0, source.options.limit ?? 8);
  return {
    items: trimmed,
    note: feedTitle ? `来自 ${feedTitle}` : '',
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}
