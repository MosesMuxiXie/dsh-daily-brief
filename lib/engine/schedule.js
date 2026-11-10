/**
 * Wall-clock helpers for the daily schedule.
 *
 * The scheduled task runs the same command for both triggers (prepare and
 * publish), so the runner decides the phase from the current time:
 *   - inside a prepare window: prepare that briefing (no delivery)
 *   - after a publish: deliver it (or generate on demand), including a late
 *     catch-up when the machine was off/asleep at the scheduled time
 *
 * All date math is done in the configured IANA timezone, never in the host's
 * local timezone, so a laptop that travels still publishes at the expected
 * wall-clock time.
 */

const TOLERANCE_MS = 15 * 1000;
// A scheduled run up to five minutes before the prepare trigger is treated as
// part of the prepare window (clock jitter, a manual early start), not as a
// catch-up of yesterday's publish.
const PREP_EARLY_MS = 5 * 60 * 1000;
// Never start a very late catch-up when the next publish is almost due; the
// upcoming briefing is fresher than the stale one.
const NEXT_PUBLISH_GUARD_MS = 60 * 60 * 1000;

const PART_FMT_CACHE = new Map();

function partFormatter(timeZone) {
  const zone = timeZone || 'Asia/Shanghai';
  let formatter = PART_FMT_CACHE.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    PART_FMT_CACHE.set(zone, formatter);
  }
  return formatter;
}

function partsIn(date, timeZone) {
  const parts = {};
  for (const part of partFormatter(timeZone).formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }
  return parts;
}

function dateKeyIn(date, timeZone) {
  const parts = partsIn(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, days) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

/** Parse "HH:MM" into minutes after midnight. */
export function clockMinutes(clock) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(clock || ''));
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function minutesClock(total) {
  const normalized = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`;
}

/** Shift a clock by minutes, wrapping across midnight. */
export function shiftClock(clock, deltaMinutes) {
  const minutes = clockMinutes(clock);
  if (minutes === null) return '07:30';
  return minutesClock(minutes + deltaMinutes);
}

/** The instant a wall clock "YYYY-MM-DD HH:MM" occurs in the given timezone. */
export function zonedDateTime(dateKey, clock, timeZone = 'Asia/Shanghai') {
  const minutes = clockMinutes(clock);
  if (minutes === null) throw new Error(`无效的时间：${clock}`);
  const [year, month, day] = String(dateKey).split('-').map(Number);
  if (!year || !month || !day) throw new Error(`无效的日期：${dateKey}`);
  const wanted = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60, 0, 0);
  let timestamp = wanted;
  // Two or three passes are enough for every IANA zone (including DST folds).
  for (let index = 0; index < 4; index += 1) {
    const shown = partsIn(new Date(timestamp), timeZone);
    const represented = Date.UTC(
      Number(shown.year),
      Number(shown.month) - 1,
      Number(shown.day),
      Number(shown.hour),
      Number(shown.minute),
      Number(shown.second),
    );
    const delta = wanted - represented;
    if (delta === 0) break;
    timestamp += delta;
  }
  return new Date(timestamp);
}

export function prepareLeadMinutes(schedule) {
  const value = Number(schedule?.prepareLeadMin);
  if (!Number.isFinite(value)) return 10;
  return Math.min(60, Math.max(1, Math.round(value)));
}

/**
 * Resolve what a scheduled run should do now.
 *
 * Task Scheduler runs the task at the next opportunity when its trigger was
 * missed (the "start when available" setting). That replay must catch up the
 * most recent publish, not prepare tomorrow's briefing:
 *   - inside a prepare window: prepare that briefing;
 *   - after today's publish (even hours later): publish/catch up today's date,
 *     and let the runner's skip rule avoid duplicate delivery;
 *   - before today's prepare window (the most recent publish is yesterday's):
 *     do nothing; yesterday's news is stale and today's schedule is about to
 *     prepare/publish fresh content. Likewise, do not start a very late
 *     catch-up when the next publish is less than an hour away.
 *
 * @returns {{phase:'prepare'|'publish'|'idle', dateKey:string, publishAt:Date,
 *            prepareAt:Date, leadMin:number, lateMs:number}}
 */
export function resolveSchedulePhase({ now = new Date(), schedule = {}, timeZone = 'Asia/Shanghai' } = {}) {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(schedule.time || '')) ? schedule.time : '07:30';
  const leadMin = prepareLeadMinutes(schedule);
  const todayKey = dateKeyIn(now, timeZone);
  const occurrences = [addDays(todayKey, -1), todayKey, addDays(todayKey, 1)].map((key) => {
    const publishAt = zonedDateTime(key, time, timeZone);
    return {
      key,
      publishAt,
      prepareAt: new Date(publishAt.getTime() - leadMin * 60 * 1000),
    };
  });

  const preparing = occurrences.find((item) => (
    now.getTime() >= item.prepareAt.getTime() - PREP_EARLY_MS
    && now.getTime() < item.publishAt.getTime() - TOLERANCE_MS
  ));
  if (preparing) {
    return {
      phase: 'prepare',
      dateKey: preparing.key,
      publishAt: preparing.publishAt,
      prepareAt: preparing.prepareAt,
      leadMin,
      lateMs: 0,
    };
  }

  const published = occurrences
    .filter((item) => item.publishAt.getTime() - TOLERANCE_MS <= now.getTime())
    .sort((left, right) => right.publishAt.getTime() - left.publishAt.getTime())[0];
  if (published) {
    const lateMs = Math.max(0, now.getTime() - published.publishAt.getTime());
    const nextPublishAt = zonedDateTime(addDays(published.key, 1), time, timeZone);
    const stale = published.key !== todayKey;
    const nextIsImminent = nextPublishAt.getTime() - now.getTime() < NEXT_PUBLISH_GUARD_MS;
    return {
      phase: stale || nextIsImminent ? 'idle' : 'publish',
      dateKey: published.key,
      publishAt: published.publishAt,
      prepareAt: published.prepareAt,
      leadMin,
      lateMs,
    };
  }

  // Unreachable for a valid daily schedule (there is always a publish in the
  // previous 24 hours); keep a safe prepare fallback for malformed clocks.
  const nextKey = addDays(todayKey, 1);
  const nextPublishAt = zonedDateTime(nextKey, time, timeZone);
  return {
    phase: 'prepare',
    dateKey: nextKey,
    publishAt: nextPublishAt,
    prepareAt: new Date(nextPublishAt.getTime() - leadMin * 60 * 1000),
    leadMin,
    lateMs: 0,
  };
}

export { TOLERANCE_MS as PUBLISH_TOLERANCE_MS };
