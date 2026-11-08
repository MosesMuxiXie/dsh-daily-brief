/**
 * iCalendar collector (Outlook / Google / ManageBac subscriptions).
 */
import ical from 'node-ical';
import { safeFetch } from '../fetch.js';
import { formatDateTime, stripHtml, truncate } from '../text.js';

export function parseIcsText(text) {
  return ical.async.parseICS(String(text ?? ''));
}

function eventStart(event) {
  const value = event?.start;
  if (value instanceof Date) return value;
  if (value && typeof value.toJSDate === 'function') return value.toJSDate();
  if (typeof value === 'string') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function eventSummary(event) {
  const raw = event?.summary;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw.val === 'string') return raw.val;
  return '';
}

export async function collectIcs(source, context = {}) {
  const response = await safeFetch(source.options.icsUrl || source.url, {
    headers: context.headers,
    timeoutMs: 20000,
  });
  const parsed = await parseIcsText(response.text);
  const now = Date.now();
  const horizon = now + 48 * 3600000;
  const events = [];
  for (const value of Object.values(parsed)) {
    if (!value || value.type !== 'VEVENT') continue;
    const start = eventStart(value);
    if (!start) continue;
    const end = value.end instanceof Date ? value.end : start;
    if (end.getTime() < now - 3600000 || start.getTime() > horizon) continue;
    const title = truncate(stripHtml(eventSummary(value)) || '未命名日程', 160);
    const location = typeof value.location === 'string' ? value.location : value.location?.val ?? '';
    const startText = formatDateTime(start, source.timezone ?? 'Asia/Shanghai');
    const endText = formatDateTime(end, source.timezone ?? 'Asia/Shanghai');
    events.push({
      id: `${value.uid ?? title}-${start.toISOString()}`,
      title,
      url: '',
      detail: truncate([location, value.description].filter(Boolean).join(' · '), 160),
      date: start.toISOString(),
      meta: startText === endText ? startText : `${startText} – ${endText}`,
      badge: '',
      tone: '',
    });
  }
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return {
    items: events.slice(0, source.options.limit ?? 8),
    note: events.length > (source.options.limit ?? 8) ? `共 ${events.length} 个日程` : '',
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}
