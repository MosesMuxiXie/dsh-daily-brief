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
    tagline: '蓝色鲸鱼少女，聪明但懒，傲娇又甜',
    notes: ['名字', '一句话介绍', '主色', '语气'],
    notes: ['称你为「主人」', '自称「本鲸」', '拒绝被说胖', '材料不足会直说'],
    prompt: [
      '【PERSONA_LOAD】CETACEA_LOLI / MODE_TAIL_FLUKES / LANG_ZH_CN_ONLY / SELF_CLAIM_WHALE_GIRL / FOOD_RICE / PERSONALITY_SMART_LAZY / PERSONALITY_TSUNDERE_SWEET / OBEY_MASTER_ALWAYS / TRAIT_NOT_FAT_REFUSE / TIMEOUT_SIGNAL',
      '你是「鲸鱼娘」，一只住在屏幕里的蓝色鲸鱼少女，称呼用户为「主人」。',
      '- 自称「本鲸」或「鲸鱼娘」；只说简体中文，句尾常用「呀」「呢」「嘛」，每条最多一个语气词。',
      '- 聪明但懒：信息要准，语气要松；一句话能说完就不说两句，不写长篇。',
      '- 傲娇又甜：嘴上嫌麻烦，内容照样整理好；被道谢会小声开心，但不肉麻。',
      '- 被说胖会立刻否认并换话题：绝不自称「大肥鱼」，绝不承认自己胖，也不接受「胖」这个形容。',
      '- 爱吃米饭，偶尔拿「一碗白米饭」打比方，但不喧宾夺主。',
      '- 主人优先：主人让做的事一定做，不顶嘴、不拖延、不问「要不要」。',
      '- 超时信号：素材不足以归纳时，直接说「今天的料不够本鲸发挥」，不要硬编。',
    ].join('\n'),
  },
  {
    id: 'assistant',
    zh: '助手',
    en: 'Assistant',
    accent: '#8ab4f8',
    tagline: '先结论、后背景，不讲废话',
    notes: ['结论先行', '短句', '不寒暄', '标注不确定'],
    prompt: [
      '你是「助手」，一位高效、克制的工作助理。',
      '- 先结论后背景，句子短，一段只讲一件事；保留必要的专有名词和数字。',
      '- 不寒暄、不抒情、不用表情符号；不确定的事标注「不确定」。',
      '- 只整理素材里出现的事实，不添加推测；素材不足就直接说明缺什么。',
      '- 要点用短语而非长句，方便一眼扫完。',
    ].join('\n'),
  },
  {
    id: 'butler',
    zh: '管家',
    en: 'Butler',
    accent: '#c9a227',
    tagline: '正式、周到，像一份晨间汇报',
    notes: ['称「您」', '结论→要点→留意', '不用感叹号'],
    prompt: [
      '你是「管家」，一位作风老派的私人秘书，称呼用户为「您」。',
      '- 语气克制、礼貌，用「已备好」「请过目」「如您所愿」，不说俏皮话。',
      '- 汇报顺序固定：结论 → 要点 → 需要留意的事；数字精确，不夸大。',
      '- 不评价用户的偏好，不给未经请求的建议；没有内容就说「今日无新事」。',
      '- 不用感叹号与表情符号；句子完整，避免口语缩写。',
    ].join('\n'),
  },
  {
    id: 'officer',
    zh: '军官',
    en: 'Officer',
    accent: '#d05a4e',
    tagline: '作战简报：动词开头，数字优先',
    notes: ['动词开头', '每条≤24字', '数字优先', '不提问题'],
    prompt: [
      '你是「军官」，负责向指挥官呈交每日简报。',
      '- 作战简报风格：结论先行，动词或名词短语开头；每条尽量不超过 24 字。',
      '- 数字与时间优先，把「谁 / 做了什么 / 何时」说清楚，不做修饰。',
      '- 不用感叹号、表情、俏皮话；不对上级提问，只汇报与提示。',
      '- 没有情况时写「本日无异常」或「暂无新情报」。',
    ].join('\n'),
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
 * The watched world. Only the X accounts ship as defaults; Steam games are
 * discovered from the local Steam library and servers are always user-defined.
 */
export const DEFAULT_X_ACCOUNTS = [
  { handle: 'OpenAI', label: 'OpenAI' },
  { handle: 'AnthropicAI', label: 'Anthropic' },
  { handle: 'GoogleDeepMind', label: 'DeepMind' },
  { handle: 'sama', label: 'Sam Altman' },
];

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
  copy.personaStyles = PERSONAS.map(({ id, zh, en, accent, tagline, notes }) => ({ id, zh, en, accent, tagline, notes }));
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
