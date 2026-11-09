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

export function selectIcsEvents(parsed, options = {}) {
  const daysAhead = Math.min(120, Math.max(1, Number(options.daysAhead) || 30));
  const now = typeof options.now === 'number' ? options.now : Date.now();
  const timezone = options.timezone || 'Asia/Shanghai';
  const horizon = now + daysAhead * 86400000;
  const events = [];
  for (const value of Object.values(parsed ?? {})) {
    if (!value || value.type !== 'VEVENT') continue;
    const start = eventStart(value);
    if (!start) continue;
    const end = value.end instanceof Date ? value.end : start;
    if (end.getTime() < now - 3600000 || start.getTime() > horizon) continue;
    const title = truncate(stripHtml(eventSummary(value)) || '未命名日程', 160);
    const location = typeof value.location === 'string' ? value.location : value.location?.val ?? '';
    const startText = formatDateTime(start, timezone);
    const endText = formatDateTime(end, timezone);
    events.push({
      id: `${value.uid ?? title}-${start.toISOString()}`,
      title,
      url: '',
      detail: truncate([location, value.description].filter(Boolean).join(' · '), 160),
      date: start.toISOString(),
      meta: startText === endText ? startText : `${startText} – ${endText}`,
      badge: '日程',
      tone: '',
    });
  }
  events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return events;
}

export async function collectIcs(source, context = {}) {
  const response = await safeFetch(source.options.icsUrl || source.url, {
    headers: context.headers,
    timeoutMs: 20000,
  });
  const parsed = await parseIcsText(response.text);
  const daysAhead = Math.min(120, Math.max(1, Number(source.options.daysAhead) || 30));
  const limit = source.options.limit ?? 8;
  const events = selectIcsEvents(parsed, {
    daysAhead,
    limit,
    timezone: source.timezone ?? 'Asia/Shanghai',
  });
  return {
    items: events.slice(0, limit),
    note:
      events.length === 0
        ? `未来 ${daysAhead} 天没有日程`
        : events.length > limit
          ? `共 ${events.length} 个日程`
          : '',
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}
