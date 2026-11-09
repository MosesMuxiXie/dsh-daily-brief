/**
 * Turn collector results into one small, ordered briefing model.
 *
 * v2 contract: at most MAX_BRIEFING_ITEMS news items in total (server status is
 * a strip, not a news row), split 4 news / 3 games and back-filled when one
 * side is quiet. Both the desktop card and the email render this model.
 */
import { MAX_BRIEFING_ITEMS, SECTION_DEFS, personaFor } from '../config.js';
import { localTime } from '../store.js';
import { relativeTime } from '../text.js';

const QUOTAS = { aiNews: 4, gameNews: 3 };

/** Sections whose items are folded into a short list of extracted points. */
export const POINT_SECTIONS = new Set(['aiNews', 'gameNews']);

function cleanLine(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/**
 * Offline fallback for a section: keep the most useful titles as short points.
 * Links are never rendered for these sections, only the extracted text.
 */
export function localPoints(items, max = 6) {
  return (items || [])
    .map((item) => cleanLine(item.title, 64))
    .filter(Boolean)
    .slice(0, max);
}


const HEADLINES = {
  whale: '蓝蓝的一天，游过来看看。',
  assistant: '今天的重点，都在这儿。',
  butler: '今日简报已备好。',
  officer: '今日简报。',
  custom: '今天的内容，都在这儿。',
};

const GREETING_SUFFIX = {
  whale: '呀',
  butler: '，先生',
};

const SUMMARIES = {
  aiNews: (n) => `${n} 条新闻`,
  gameNews: (n) => `${n} 条公告`,
  server: (n, section) => (section?.server?.online ? '在线' : '离线'),
  mail: (n) => `${n} 封邮件`,
  calendar: (n) => `${n} 个日程`,
  tasks: (n) => `${n} 项待办`,
  browser: (n) => `${n} 条足迹`,
  managebac: (n) => `${n} 条通知`,
  feishu: (n) => `${n} 条飞书更新`,
  custom: (n) => `${n} 条更新`,
};

function hourIn(timeZone, now) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hour12: false, timeZone }).format(now));
  } catch {
    return now.getHours();
  }
}

export function greetingFor(personaId, timeZone, now = new Date()) {
  const hour = hourIn(timeZone, now);
  let base = '晚上好';
  if (hour < 5) base = '夜深了';
  else if (hour < 11) base = '早上好';
  else if (hour < 13) base = '中午好';
  else if (hour < 18) base = '下午好';
  return `${base}${GREETING_SUFFIX[personaId] ?? ''}`;
}

export function dateLabel(now, timeZone) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long',
    }).format(now);
  } catch {
    return now.toDateString();
  }
}

export function shortDate(now, timeZone) {
  try {
    return {
      md: new Intl.DateTimeFormat('zh-CN', { timeZone, month: 'numeric', day: 'numeric' }).format(now),
      weekday: new Intl.DateTimeFormat('zh-CN', { timeZone, weekday: 'short' }).format(now),
    };
  } catch {
    return { md: now.toISOString().slice(5, 10), weekday: '' };
  }
}

function dedupe(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = (item.url || item.title).toLowerCase().replace(/#.*$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function whenText(date, now) {
  const time = new Date(date).getTime();
  if (!Number.isFinite(time)) return '';
  if (time - now.getTime() > 3600000) {
    const stamp = new Date(time).toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${stamp}（${relativeTime(date, now)}）`;
  }
  return relativeTime(date, now);
}

function byNearNow(a, b) {  const now = Date.now();
  const ta = new Date(a.date).getTime();
  const tb = new Date(b.date).getTime();
  if (!Number.isFinite(ta) && !Number.isFinite(tb)) return 0;
  if (!Number.isFinite(ta)) return 1;
  if (!Number.isFinite(tb)) return -1;
  return Math.abs(ta - now) - Math.abs(tb - now);
}

/** Split the global budget so the card always fills up from wherever news is. */
function allocate(prepared, max) {
  const budget = {};
  const countOf = (id) => (prepared.get(id) || []).length;
  const newest = (id) => {
    const items = prepared.get(id) || [];
    const stamp = items.length > 0 ? new Date(items[0].date).getTime() : 0;
    return Number.isFinite(stamp) ? stamp : 0;
  };
  // Any other section that actually has something gets one guaranteed row, so
  // school mail, ManageBac, Feishu and calendar notices are never squeezed out
  // by the two focus sections. Up to four such sections claim a seat.
  const others = [...prepared.keys()]
    .filter((id) => id !== 'server' && !(id in QUOTAS) && countOf(id) > 0)
    .sort((a, b) => newest(b) - newest(a));
  const reserved = others.slice(0, Math.min(4, Math.max(0, max - 6)));
  const quotas =
    reserved.length <= 2 ? { aiNews: 4, gameNews: 3 } : { aiNews: 3, gameNews: 2 };

  let used = 0;
  for (const [id, quota] of Object.entries(quotas)) {
    const take = Math.min(quota, countOf(id));
    budget[id] = take;
    used += take;
  }
  for (const id of reserved) {
    if (used >= max) break;
    budget[id] = 1;
    used += 1;
  }
  // Back-fill one item at a time, alternating focus sections first.
  let progressed = true;
  while (used < max && progressed) {
    progressed = false;
    for (const id of ['aiNews', 'gameNews']) {
      if (used >= max) break;
      if ((budget[id] ?? 0) < countOf(id)) {
        budget[id] += 1;
        used += 1;
        progressed = true;
      }
    }
  }
  // Still room: newest non-focus sections get the rest, one row per turn.
  if (used < max) {
    const rest = others.filter((id) => !reserved.includes(id));
    let took = true;
    while (used < max && took) {
      took = false;
      for (const id of [...reserved, ...rest]) {
        if (used >= max) break;
        if ((budget[id] ?? 0) < countOf(id)) {
          budget[id] = (budget[id] ?? 0) + 1;
          used += 1;
          took = true;
        }
      }
    }
  }
  return budget;
}

function headlineFor({ aiCount, gameCount, otherCount, personaId, max }) {
  if (aiCount + gameCount + otherCount === 0) return '今天很安静，没有新消息。';
  const more = otherCount > 0 ? `，另有 ${otherCount} 条其他更新` : '';
  if (aiCount > 0 && gameCount > 0) return `${aiCount} 条新闻，${gameCount} 条游戏消息${more}。`;
  if (aiCount > 0) return `新闻这边有 ${aiCount} 条新内容${more}。`;
  if (gameCount > 0) return `关注的游戏有 ${gameCount} 条更新${more}。`;
  if (otherCount > 0) return `今天还有 ${otherCount} 条其他更新。`;
  return HEADLINES[personaId] ?? HEADLINES.warm;
}

export function buildBriefing({ config, results, dateKey, now = new Date() }) {
  const timezone = config.timezone;
  const persona = personaFor(config);
  const maxItems = Math.max(1, Math.min(MAX_BRIEFING_ITEMS, Number(config.briefing?.maxItems) || MAX_BRIEFING_ITEMS));
  const bySection = new Map();
  const stats = { sources: 0, ok: 0, issues: 0, items: 0, sections: 0, aiItems: 0, gameItems: 0 };
  const issueNotes = new Map();
  let serverInfo = null;

  for (const entry of results) {
    const source = entry?.source;
    const result = entry?.result;
    if (!source || !result || source.enabled === false) continue;
    stats.sources += 1;
    if (result.status === 'ok') stats.ok += 1;
    if (['error', 'auth', 'degraded'].includes(result.status)) {
      stats.issues += 1;
      const notes = issueNotes.get(source.section) || [];
      notes.push(result.status === 'auth' ? '需要重新连接' : result.note || '获取失败');
      issueNotes.set(source.section, notes);
    }
    if (result.server) serverInfo = result.server;
    if (!result.items || result.items.length === 0) {
      // Keep the two focus sections visible even when every source failed, so
      // the card says "nothing yet" instead of silently dropping news or games.
      if (source.section === 'aiNews' || source.section === 'gameNews') {
        if (!bySection.has(source.section)) bySection.set(source.section, []);
        bySection.get(source.section).push({ source, result });
      }
      continue;
    }
    if (!bySection.has(source.section)) bySection.set(source.section, []);
    bySection.get(source.section).push({ source, result });
  }

  const counts = {};
  const prepared = new Map();
  for (const [id, entries] of bySection) {
    const items = dedupe(entries.flatMap((entry) => entry.result.items)).sort(byNearNow);
    // Point-style sections are rendered as one short line per item, so keep the
    // rows and the extracted points in sync (at most six lines each).
    const capped = POINT_SECTIONS.has(id) ? items.slice(0, 6) : items;
    prepared.set(id, capped);
    counts[id] = capped.length;
  }

  // One short line per section, and only when that section ended up empty.
  // A limited X request that still produced cached or blog items should not
  // take a line in a five-item card.
  const warnings = [];
  for (const [sectionId, notes] of issueNotes) {
    if ((counts[sectionId] || 0) > 0) continue;
    const def = SECTION_DEFS.find((item) => item.id === sectionId);
    const unique = [...new Set(notes)].slice(0, 1).join('；');
    warnings.push(`${def ? def.zh : '来源'}：${unique}`);
  }
  if (warnings.length > 3) {
    warnings.splice(2, warnings.length, `另有 ${warnings.length - 2} 个板块需要留意`);
  }

  const budget = allocate(prepared, maxItems);
  const sections = [];
  for (const def of SECTION_DEFS) {
    const focus = def.id === 'aiNews' || def.id === 'gameNews';
    const entries = bySection.get(def.id) || [];
    if (entries.length === 0 && !focus) continue;
    let items = prepared.get(def.id) ?? [];
    if (def.id !== 'server') {
      items = items.slice(0, budget[def.id] ?? 0);
    } else {
      items = items.slice(0, 3);
    }
    const missing = entries.length === 0;
    const sources = entries.map((entry) => ({
      id: entry.source.id,
      label: entry.source.label,
      status: entry.result.status,
      note: entry.result.note ?? '',
      count: entry.result.items.length,
    }));
    const hasIssue = sources.some((source) => ['error', 'auth', 'degraded'].includes(source.status));
    const section = {
      id: def.id,
      zh: def.zh,
      en: def.en,
      icon: def.icon,
      accent: def.accent,
      items: items.map((item) => ({
        ...item,
        when: whenText(item.date, now),
      })),
      empty: items.length === 0,
      sources,
      status: hasIssue ? 'partial' : 'ok',
      summary:
        items.length === 0
          ? missing
            ? def.id === 'aiNews'
              ? '还没有添加新闻来源：粘贴一个 X 账号 ID 或 RSS 订阅地址即可'
              : def.id === 'gameNews'
                ? '还没有添加游戏：在面板里粘贴 Steam appid，或从 Steam 库选择'
                : '暂无更新'
            : def.id === 'aiNews'
              ? '暂时没有新内容'
              : def.id === 'gameNews'
                ? '暂时没有新公告'
                : '暂无更新'
          : (SUMMARIES[def.id] ?? SUMMARIES.custom)(items.length, { server: serverInfo }),
      digest: '',
      points: POINT_SECTIONS.has(def.id) && items.length > 0 ? localPoints(items) : [],
    };
    if (def.id === 'server' && serverInfo) section.server = serverInfo;
    sections.push(section);
    stats.sections += 1;
    if (def.id === 'aiNews') stats.aiItems = items.length;
    if (def.id === 'gameNews') stats.gameItems = items.length;
    if (def.id !== 'server') stats.items += items.length;
  }

  // The Minecraft server strip is useful even when it has no "news" item.
  if (serverInfo && !sections.some((section) => section.id === 'server')) {
    const def = SECTION_DEFS.find((section) => section.id === 'server');
    sections.push({
      id: 'server',
      zh: def.zh,
      en: def.en,
      icon: def.icon,
      accent: def.accent,
      items: [],
      sources: [],
      status: serverInfo.online ? 'ok' : 'partial',
      summary: serverInfo.online ? '在线' : '离线',
      server: serverInfo,
    });
    stats.sections += 1;
  }

  const chips = sections
    .filter((section) => section.id !== 'server')
    .map((section) => ({ id: section.id, label: section.zh, count: section.items.length, accent: section.accent }));

  const short = shortDate(now, timezone);

  return {
    dateKey,
    generatedAt: now.toISOString(),
    timezone,
    timeLabel: localTime(now, timezone),
    dateLabel: dateLabel(now, timezone),
    shortDate: short.md,
    weekday: short.weekday,
    greeting: greetingFor(persona.id, timezone, now),
    headline: headlineFor({
      aiCount: stats.aiItems,
      gameCount: stats.gameItems,
      otherCount: Math.max(0, stats.items - stats.aiItems - stats.gameItems),
      personaId: persona.id,
      max: maxItems,
    }),
    intro: '',
    scheduleNote:
      config.schedule?.enabled === false
        ? '自动生成已关闭'
        : `每天 ${String(config.schedule?.time || '07:30')} 自动生成`,
    persona: {
      id: persona.id,
      name: persona.zh,
      en: persona.en,
      accent: persona.accent,
      tagline: persona.tagline,
      prompt: persona.prompt,
    },
    sections,
    chips,
    stats,
    warnings,
    ai: null,
  };
}

const AI_GREETING_RE = /^(早上好|上午好|中午好|下午好|晚上好|夜深了|早安|午安|晚安)[\s，,：:！!—\-]*/;

function cleanAiLine(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .trim()
    .replace(AI_GREETING_RE, '')
    .replace(/[。.]$/, '')
    .slice(0, max)
    .trim();
}

function cleanPoints(value, min, max) {
  const list = Array.isArray(value) ? value : [];
  const cleaned = list
    .map((entry) => cleanAiLine(entry, 60))
    .filter((entry) => entry.length >= 4)
    .slice(0, max);
  return cleaned.length >= min ? cleaned : [];
}

export function applyAiPolish(briefing, ai) {
  if (!ai || typeof ai !== 'object') return briefing;
  const headline = cleanAiLine(ai.headline, 30);
  const intro = cleanAiLine(ai.intro, 110);
  const next = { ...briefing, ai: { ...ai, headline, intro } };
  if (headline !== '') next.headline = headline;
  if (intro !== '') next.intro = intro;
  const points = ai.points && typeof ai.points === 'object' ? ai.points : null;
  const digests = ai.digests && typeof ai.digests === 'object' ? ai.digests : null;
  if (points || digests || ai.sections) {
    next.sections = briefing.sections.map((section) => {
      let out = section;
      if (points && POINT_SECTIONS.has(section.id)) {
        const list = cleanPoints(points[section.id], 2, 6);
        if (list.length > 0) out = { ...out, points: list, digest: '' };
      }
      // Older briefings stored a single paragraph; renderers still accept it.
      if (digests && POINT_SECTIONS.has(section.id) && !points) {
        const text = cleanAiLine(digests[section.id], 360);
        if (text.length >= 12) out = { ...out, digest: text };
      }
      if (ai.sections && typeof ai.sections === 'object') {
        const note = ai.sections[section.id];
        if (typeof note === 'string' && note.trim() !== '') out = { ...out, aiNote: note.trim().slice(0, 240) };
      }
      return out;
    });
  }
  return next;
}
