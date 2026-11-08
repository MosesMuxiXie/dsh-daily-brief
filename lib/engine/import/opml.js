/**
 * OPML import: flatten every outline that carries an xmlUrl.
 */
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

function walk(node, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 12) return;
  const outline = node.outline;
  const list = Array.isArray(outline) ? outline : outline ? [outline] : [];
  for (const entry of list) {
    const url = entry?.['@_xmlUrl'];
    const title = entry?.['@_title'] ?? entry?.['@_text'] ?? '';
    if (typeof url === 'string' && url.trim() !== '') {
      out.push({ title: String(title).trim().slice(0, 120), url: url.trim() });
    }
    walk(entry, out, depth + 1);
  }
}

export function parseOpml(text) {
  const document = parser.parse(String(text ?? ''));
  const out = [];
  const body = document?.opml?.body;
  walk({ outline: body?.outline ?? body }, out);
  if (out.length === 0) walk(document, out);
  const seen = new Set();
  return out.filter((entry) => {
    if (seen.has(entry.url)) return false;
    seen.add(entry.url);
    return true;
  });
}
