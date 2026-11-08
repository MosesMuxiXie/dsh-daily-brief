/**
 * Shared configuration model for the daily brief plugin.
 *
 * Version 2 narrows the briefing on purpose: AI news comes from a handful of
 * watched X accounts, games from the few titles the user actually plays, and
 * the server section from one Minecraft server. Everything else (RSS, mail,
 * calendar, webhooks) still works, but it is opt-in and hidden from the
 * simplified panel.
 */
export const SOURCE_TYPES = [
  'x',
  'steam',
  'minecraft',
  'rss',
  'atom',
  'json',
  'ics',
  'page',
  'http',
  'graph',
  'imap',
  'browser',
  'managebac',
];

/** Briefing sections, in display order. Focus sections come first. */
export const SECTION_DEFS = [
  { id: 'aiNews', zh: 'AI 动态', en: 'AI', icon: 'spark', accent: '#C2603F' },
  { id: 'gameNews', zh: '游戏', en: 'Games', icon: 'game', accent: '#8A4D6D' },
  { id: 'server', zh: '服务器', en: 'Server', icon: 'pulse', accent: '#2F7D63' },
  { id: 'mail', zh: '邮箱', en: 'Mail', icon: 'mail', accent: '#4C7DF0' },
  { id: 'managebac', zh: '学校通知', en: 'School', icon: 'school', accent: '#8B5CF6' },
  { id: 'feishu', zh: '飞书', en: 'Feishu', icon: 'chat', accent: '#3370FF' },
  { id: 'tasks', zh: '待办', en: 'To do', icon: 'check', accent: '#16A085' },
  { id: 'calendar', zh: '日历', en: 'Calendar', icon: 'calendar', accent: '#E67E22' },
  { id: 'browser', zh: '浏览器足迹', en: 'Browsing', icon: 'compass', accent: '#A16207' },
  { id: 'custom', zh: '自定义', en: 'Custom', icon: 'layers', accent: '#64748B' },
];

export const SECTION_IDS = SECTION_DEFS.map((section) => section.id);

/** The sections the simplified panel and the card layout care about. */
export const FOCUS_SECTIONS = ['aiNews', 'gameNews', 'server'];

/** Hard ceiling for one briefing. The whole point of v2 is a five-item card. */
export const MAX_BRIEFING_ITEMS = 5;

/**
 * Briefing personalities. `accent` colors the card and the popup masthead, so
 * the chosen card feels different without changing the layout.
 */
export const PERSONAS = [
  {
    id: 'whale',
    zh: '鲸鱼娘',
    en: 'Whale',
    accent: '#4aa8ff',
    tagline: '蓝色的大肥鱼，慢慢游过来陪你',
    prompt: '语气温柔、轻快，像一只慢悠悠的蓝鲸，偶尔用“呀”“呢”收尾，不催促、不说教。',
  },
  {
    id: 'assistant',
    zh: '助手',
    en: 'Assistant',
    accent: '#8ab4f8',
    tagline: '清楚、可靠，把重点放在前面',
    prompt: '语气清楚、可靠，先给结论再给一点背景，句子短，不寒暄。',
  },
  {
    id: 'butler',
    zh: '管家',
    en: 'Butler',
    accent: '#c9a227',
    tagline: '正式、周到，像一份晨间汇报',
    prompt: '语气克制、礼貌，像一位经验丰富的私人管家，称用户为“您”。',
  },
  {
    id: 'officer',
    zh: '军官',
    en: 'Officer',
    accent: '#d05a4e',
    tagline: '简短、果断，像作战简报',
    prompt: '语气简短、果断，像作战简报：先报结论，再列要点，不用感叹号，不寒暄。',
  },
  {
    id: 'custom',
    zh: '自定义',
    en: 'Custom',
    accent: '#9a8cff',
    tagline: '名字、语气、颜色都由你定',
    prompt: '',
  },
];

const LEGACY_PERSONAS = {
  warm: 'whale',
  concise: 'assistant',
  energetic: 'whale',
  calm: 'assistant',
  butler: 'butler',
};

export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

/**
 * The watched world. Four X accounts, three Steam games, one Minecraft server.
 * All of them are editable from the panel.
 */
export const DEFAULT_X_ACCOUNTS = [
  { handle: 'OpenAI', label: 'OpenAI' },
  { handle: 'AnthropicAI', label: 'Anthropic' },
  { handle: 'GoogleDeepMind', label: 'DeepMind' },
  { handle: 'sama', label: 'Sam Altman' },
];

export const DEFAULT_STEAM_GAMES = [
  { appid: 502500, label: 'ACE COMBAT 7' },
  { appid: 5370600, label: 'ACE COMBAT ZERO' },
  { appid: 444200, label: 'World of Tanks Blitz' },
];

export const DEFAULT_MINECRAFT = { host: 'play.simpfun.cn', port: 11848, label: '我的世界服务器' };

function presetSources() {
  const sources = [];
  let order = 10;
  for (const account of DEFAULT_X_ACCOUNTS) {
    sources.push({
      id: `x-${account.handle.toLowerCase()}`,
      type: 'x',
      section: 'aiNews',
      label: account.label,
      enabled: true,
      order,
      options: { handle: account.handle, limit: 3, sinceHours: 40 },
    });
    order += 1;
  }
  order = 20;
  for (const game of DEFAULT_STEAM_GAMES) {
    sources.push({
      id: `steam-${game.appid}`,
      type: 'steam',
      section: 'gameNews',
      label: game.label,
      enabled: true,
      order,
      options: { appid: game.appid, limit: 3, sinceHours: 24 * 14 },
    });
    order += 1;
  }
  sources.push({
    id: 'mc-main',
    type: 'minecraft',
    section: 'server',
    label: DEFAULT_MINECRAFT.label,
    enabled: true,
    order: 30,
    options: { host: DEFAULT_MINECRAFT.host, port: DEFAULT_MINECRAFT.port, limit: 1 },
  });
  return sources;
}

export function defaultConfig() {
  return {
    version: 2,
    timezone: DEFAULT_TIMEZONE,
    schedule: { time: '07:30', enabled: true, wakeToRun: false },
    persona: { preset: 'whale', customPrompt: '', customName: '', customTagline: '', customAccent: '' },
    sources: presetSources(),
    delivery: {
      popup: {
        enabled: true,
        position: 'bottom-right',
        width: 560,
        height: 860,
        openOnGenerate: true,
      },
      openBriefing: false,
      email: { enabled: false, to: '', host: '', port: 465, secure: true, user: '', from: '' },
      webhook: { enabled: false, kind: 'ntfy', url: '', topic: '' },
    },
    ai: { polish: 'auto', timeoutSec: 120 },
    graph: { clientId: '' },
    retentionDays: 30,
    createdAt: new Date().toISOString(),
  };
}

export function newSourceId() {
  return `src_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;
}

export function isEmail(value) {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

export function isHttpUrl(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function text(value, fallback = '', max = 240) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  return trimmed === '' ? fallback : trimmed.slice(0, max);
}

function bool(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function num(value, fallback, min, max) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function obj(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function normalizeOptions(type, raw) {
  const options = obj(raw);
  const normalized = {
    limit: num(options.limit, type === 'x' ? 3 : type === 'steam' ? 3 : 8, 1, 30),
    sinceHours: num(options.sinceHours, type === 'steam' ? 24 * 14 : type === 'x' ? 40 : 24, 1, 24 * 30),
    allowPrivate: bool(options.allowPrivate, type === 'http'),
    expectStatus: num(options.expectStatus, 200, 100, 599),
    method: text(options.method, 'GET', 8).toUpperCase(),
    keyword: text(options.keyword, '', 120),
    selector: text(options.selector, '', 300),
    icsUrl: text(options.icsUrl, '', 2000),
    mailbox: text(options.mailbox, 'INBOX', 120),
    mode: options.mode === 'graph' ? 'graph' : 'imap',
    browsers: Array.isArray(options.browsers)
      ? options.browsers.filter((name) => name === 'edge' || name === 'chrome').slice(0, 4)
      : ['edge', 'chrome'],
  };
  if (type === 'x') {
    normalized.handle = text(options.handle, '', 64).replace(/^@/, '');
  }
  if (type === 'steam') {
    normalized.appid = num(options.appid, 0, 0, 99_999_999);
  }
  if (type === 'minecraft') {
    normalized.host = text(options.host, '', 200).replace(/^minecraft:\/\//i, '').replace(/\/$/, '');
    normalized.port = num(options.port, 25565, 1, 65535);
  }
  if (options.mapping && typeof options.mapping === 'object') {
    normalized.mapping = {
      items: text(options.mapping.items, 'items', 160),
      title: text(options.mapping.title, 'title', 160),
      url: text(options.mapping.url, 'url', 160),
      date: text(options.mapping.date, 'date', 160),
      summary: text(options.mapping.summary, 'summary', 160),
    };
  }
  if (Array.isArray(options.headerNames)) {
    normalized.headerNames = options.headerNames
      .filter((name) => typeof name === 'string' && name.trim() !== '')
      .slice(0, 8)
      .map((name) => name.trim().slice(0, 80));
  }
  return normalized;
}

export function normalizeSource(raw, index = 0) {
  const input = obj(raw);
  const type = SOURCE_TYPES.includes(input.type) ? input.type : 'rss';
  const section = SECTION_IDS.includes(input.section) ? input.section : guessSection(type);
  const options = normalizeOptions(type, input.options);
  const source = {
    id: text(input.id, newSourceId(), 80),
    type,
    section,
    label: text(input.label, defaultLabel(type, input.url, options), 60),
    enabled: bool(input.enabled, true),
    order: num(input.order, index * 10, 0, 100000),
    options,
  };
  if (type !== 'browser' && type !== 'x' && type !== 'minecraft') {
    source.url = text(input.url, '', 4000);
  }
  if (type === 'x') {
    source.url = `https://x.com/${options.handle}`;
  }
  if (type === 'steam') {
    source.url = `https://store.steampowered.com/app/${options.appid}`;
  }
  if (type === 'minecraft') {
    source.url = '';
  }
  if (type === 'imap' || type === 'graph') {
    const account = obj(input.account);
    source.account = {
      user: text(account.user, '', 160),
      host: text(account.host, '', 200),
      port: num(account.port, 993, 1, 65535),
      secure: bool(account.secure, true),
    };
  }
  if (input.last && typeof input.last === 'object') {
    source.last = {
      ok: bool(input.last.ok, false),
      at: text(input.last.at, '', 40),
      count: num(input.last.count, 0, 0, 9999),
      error: text(input.last.error, '', 300),
    };
  }
  return source;
}

function guessSection(type) {
  if (type === 'x') return 'aiNews';
  if (type === 'steam') return 'gameNews';
  if (type === 'minecraft') return 'server';
  if (type === 'imap' || type === 'graph') return 'mail';
  if (type === 'ics') return 'calendar';
  if (type === 'http') return 'server';
  if (type === 'browser') return 'browser';
  if (type === 'managebac') return 'managebac';
  return 'custom';
}

function defaultLabel(type, url, options) {
  if (type === 'x') return options.handle ? `@${options.handle}` : 'X 账号';
  if (type === 'steam') return options.appid ? `Steam ${options.appid}` : 'Steam 游戏';
  if (type === 'minecraft') return options.host || 'Minecraft 服务器';
  if (type === 'browser') return '浏览器足迹';
  if (type === 'graph') return 'Microsoft 账户';
  if (type === 'imap') return '邮箱账户';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return type === 'ics' ? '日历订阅' : '新来源';
  }
}

/**
 * v1 shipped nine broad preset feeds (Hacker News, arXiv, Steam CS2, …).
 * v2 replaces those automatically while keeping anything the user added by hand.
 */
function migrateSources(input, base) {
  const raw = Array.isArray(input.sources) ? input.sources : null;
  const version = Number(input.version) || 1;
  if (!raw) return base.sources;
  const migrated = raw
    .filter((source) => {
      if (version >= 2) return true;
      const id = String(source?.id ?? '');
      // Drop the old broad presets so the card is not flooded again.
      return !id.startsWith('preset-');
    })
    .map((source, index) => normalizeSource(source, index));
  if (version < 2) {
    // Keep the new focus presets next to any hand-added source.
    const fresh = base.sources.map((source, index) => normalizeSource(source, index));
    const keptIds = new Set(fresh.map((source) => source.id));
    const extras = migrated.filter((source) => !keptIds.has(source.id));
    return [...fresh, ...extras];
  }
  return migrated.length > 0 ? migrated : base.sources;
}

export function mergeConfig(raw) {
  const base = defaultConfig();
  const input = obj(raw);
  const deduped = [];
  const seen = new Set();
  for (const source of migrateSources(input, base)) {
    let id = source.id;
    while (seen.has(id)) id = newSourceId();
    seen.add(id);
    deduped.push({ ...source, id });
  }
  deduped.forEach((source, index) => {
    source.order = index * 10;
  });

  const schedule = obj(input.schedule);
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(text(schedule.time, '')) ? text(schedule.time, '07:30') : base.schedule.time;
  const persona = obj(input.persona);
  const wantedPreset = LEGACY_PERSONAS[persona.preset] ?? persona.preset;
  const preset = PERSONAS.some((item) => item.id === wantedPreset) ? wantedPreset : base.persona.preset;
  const accent = text(persona.customAccent, '', 20);
  const delivery = obj(input.delivery);
  const popup = obj(delivery.popup);
  const email = obj(delivery.email);
  const webhook = obj(delivery.webhook);
  const ai = obj(input.ai);
  const graph = obj(input.graph);
  const positions = ['bottom-right', 'top-right', 'center'];

  return {
    version: 2,
    timezone: text(input.timezone, DEFAULT_TIMEZONE, 80),
    schedule: {
      time,
      enabled: bool(schedule.enabled, base.schedule.enabled),
      wakeToRun: bool(schedule.wakeToRun, base.schedule.wakeToRun),
    },
    persona: {
      preset,
      customPrompt: text(persona.customPrompt, '', 2000),
      customName: text(persona.customName, '', 24),
      customTagline: text(persona.customTagline, '', 60),
      customAccent: /^#[0-9a-f]{6}$/i.test(accent) ? accent.toLowerCase() : '',
    },
    sources: deduped,
    delivery: {
      popup: {
        enabled: bool(popup.enabled, base.delivery.popup.enabled),
        position: positions.includes(popup.position) ? popup.position : base.delivery.popup.position,
        width: num(popup.width, base.delivery.popup.width, 360, 1200),
        height: num(popup.height, base.delivery.popup.height, 480, 1600),
        openOnGenerate: bool(popup.openOnGenerate, base.delivery.popup.openOnGenerate),
      },
      openBriefing: bool(delivery.openBriefing, base.delivery.openBriefing),
      email: {
        enabled: bool(email.enabled, false),
        to: text(email.to, '', 300),
        host: text(email.host, '', 300),
        port: num(email.port, 465, 1, 65535),
        secure: bool(email.secure, true),
        user: text(email.user, '', 300),
        from: text(email.from, '', 300),
      },
      webhook: {
        enabled: bool(webhook.enabled, false),
        kind: ['ntfy', 'telegram', 'bark', 'generic'].includes(webhook.kind) ? webhook.kind : 'ntfy',
        url: text(webhook.url, '', 2000),
        topic: text(webhook.topic, '', 200),
      },
    },
    ai: {
      polish: ['off', 'auto'].includes(ai.polish) ? ai.polish : base.ai.polish,
      timeoutSec: num(ai.timeoutSec, 120, 30, 600),
    },
    graph: { clientId: text(graph.clientId, '', 200) },
    retentionDays: num(input.retentionDays, 30, 1, 365),
    createdAt: text(input.createdAt, base.createdAt, 40),
    updatedAt: new Date().toISOString(),
  };
}

/** Remove runtime-only fields before sending configuration to the browser. */
export function publicConfig(config) {
  const copy = JSON.parse(JSON.stringify(config));
  for (const source of copy.sources ?? []) {
    if (source.options?.headerNames) delete source.options.headerNames;
  }
  // The panel offers the built-in cards; the custom slot fills in from config.
  copy.personaStyles = PERSONAS.map(({ id, zh, en, accent, tagline }) => ({ id, zh, en, accent, tagline }));
  return copy;
}

export function personaFor(config) {
  const saved = config.persona ?? {};
  const found = PERSONAS.find((persona) => persona.id === saved.preset) ?? PERSONAS[0];
  if (found.id !== 'custom') return found;
  const accent = /^#[0-9a-f]{6}$/i.test(saved.customAccent ?? '') ? saved.customAccent : found.accent;
  return {
    ...found,
    zh: saved.customName || found.zh,
    en: 'Custom',
    accent,
    tagline: saved.customTagline || found.tagline,
    prompt: saved.customPrompt || '语气自然，像一位熟悉你的朋友。',
  };
}

export function sectionDef(id) {
  return SECTION_DEFS.find((section) => section.id === id) ?? SECTION_DEFS[SECTION_DEFS.length - 1];
}
