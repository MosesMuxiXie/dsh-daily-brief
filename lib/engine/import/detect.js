/**
 * The import brain: one pasted string in, previewable source proposals out.
 *
 * Everything the wizard shows comes from actually fetching the target once
 * (except OAuth-only links), so "add" never surprises the user later.
 */
import { XMLParser } from 'fast-xml-parser';
import { parse as parseHtml } from 'node-html-parser';
import { safeFetch } from '../fetch.js';
import { parseFeedXml } from '../collect/feed.js';
import { parseIcsText } from '../collect/ics.js';
import { guessJsonMapping, getByPath } from '../collect/json.js';
import { discoverFeeds, extractLinks } from '../collect/page.js';
import { isEmail } from '../config.js';
import { parseOpml } from './opml.js';
import { stripHtml, truncate, hostOf } from '../text.js';

const MICROSOFT_MAIL = /(^|\.)(outlook|hotmail|live|msn)\.(com|cn)$/i;
// Word boundaries matter: an unanchored /ai/ matches the "ai" inside
// "rainplay" and would file a server monitor under AI news.
const AI_HINTS =
  /(^|[^a-z])(ai|llm|gpt|openai|anthropic|deepmind|arxiv|verge|huggingface|machinelearn(ing)?)([^a-z]|$)|人工智能|大模型|机器学习|新智元|量子位|机器之心/i;
const GAME_HINTS = /(^|[^a-z])(game|gaming|steam|ign|gamersky|vgtime|nintendo|playstation|xbox)([^a-z]|$)|游戏|游民|3dm/i;
const SERVER_HINTS =
  /(^|[^a-z])(server|monitor|monitoring|status|panel|uptime|mcs|minecraft|mc|dashboard|console)([^a-z]|$)|服务器|监控|面板|状态|开服|后台/i;

const IMAP_PRESETS = [
  { test: /(^|\.)gmail\.com$/i, host: 'imap.gmail.com', port: 993, note: 'Gmail 需要应用专用密码' },
  { test: /(^|\.)qq\.com$/i, host: 'imap.qq.com', port: 993, note: 'QQ 邮箱需要开启 IMAP 并使用授权码' },
  { test: /(^|\.)(163|126)\.com$/i, host: 'imap.163.com', port: 993, note: '网易邮箱需要授权码' },
  { test: /(^|\.)icloud\.com$/i, host: 'imap.mail.me.com', port: 993, note: 'iCloud 需要 App 专用密码' },
  { test: /(^|\.)yahoo\.com$/i, host: 'imap.mail.yahoo.com', port: 993, note: 'Yahoo 需要应用密码' },
  { test: /(^|\.)foxmail\.com$/i, host: 'imap.qq.com', port: 993, note: 'Foxmail 需要授权码' },
];

export function splitInputs(raw) {
  const lines = String(raw ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  return [...new Set(lines)].slice(0, 20);
}

export function guessMailSettings(email) {
  const domain = String(email).split('@')[1] ?? '';
  const preset = IMAP_PRESETS.find((entry) => entry.test.test(domain));
  if (preset) return { host: preset.host, port: preset.port, secure: true, note: preset.note };
  return { host: '', port: 993, secure: true, note: '请填写学校邮箱的 IMAP 服务器（可向 IT 部门索取）' };
}

function isLocalHost(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host.endsWith('.local') || isPrivateIp(host);
  } catch {
    return false;
  }
}

/** True for loopback, RFC1918 and link-local addresses (IPv4 or IPv6). */
export function isPrivateIp(host) {
  const value = String(host ?? '').toLowerCase();
  if (value === '' ) return false;
  if (value === 'localhost' || value === '::1' || value === '::') return true;
  if (value.endsWith('.local') || value.endsWith('.lan') || value.endsWith('.internal')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split('.').map(Number);
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  return false;
}

function isPrivateUrl(url) {
  try {
    return isPrivateIp(new URL(url).hostname.replace(/^\[|\]$/g, ''));
  } catch {
    return false;
  }
}

function base(overrides) {
  return {
    ok: true,
    type: 'rss',
    section: 'custom',
    label: '',
    url: '',
    options: {},
    account: null,
    requires: [],
    warnings: [],
    confidence: 'medium',
    note: '',
    preview: { title: '', subtitle: '', items: [] },
    ...overrides,
  };
}

function previewItems(items) {
  return items.slice(0, 4).map((item) => ({
    title: truncate(item.title ?? '', 120),
    detail: truncate(item.detail ?? item.meta ?? '', 120),
    date: item.date ?? '',
  }));
}

function sectionFor(url, kind, fallback, hint = '') {
  if (fallback) return fallback;
  const host = hostOf(url);
  const text = `${host} ${url} ${hint}`.toLowerCase();
  if (kind === 'ics') return 'calendar';
  if (/managebac/i.test(host)) return 'managebac';
  if (SERVER_HINTS.test(text) || isLocalHost(url)) return 'server';
  if (kind === 'http') return 'custom';
  if (GAME_HINTS.test(text)) return 'gameNews';
  if (AI_HINTS.test(text)) return 'aiNews';
  return 'custom';
}

async function fetchProbe(url) {
  const allowPrivate = isLocalHost(url);
  return safeFetch(url, {
    timeoutMs: 16000,
    maxBytes: 2 * 1024 * 1024,
    allowPrivate,
    headers: { accept: 'application/rss+xml, application/atom+xml, application/json, text/calendar, text/html;q=0.9, */*;q=0.5' },
  });
}

function labelFor(url, title) {
  const host = hostOf(url).replace(/^www\./, '');
  const name = String(title ?? '').trim();
  if (name.length >= 2 && name.length <= 40) return name.slice(0, 60);
  return truncate(host || '新来源', 60);
}

function emailProposals(email) {
  const domain = email.split('@')[1] ?? '';
  const settings = guessMailSettings(email);
  const results = [];
  if (MICROSOFT_MAIL.test(domain)) {
    results.push(
      base({
        type: 'graph',
        section: 'mail',
        label: `${email.split('@')[0]} 的 Outlook`,
        account: { user: email, host: '', port: 993, secure: true },
        requires: ['microsoft'],
        note: '推荐使用 Microsoft Graph 连接：一次授权即可读取邮件、日历与 To Do。',
        confidence: 'high',
      }),
    );
  }
  results.push(
    base({
      type: 'imap',
      section: 'mail',
      label: `${email.split('@')[0]} 的邮箱`,
      account: { user: email, host: settings.host, port: settings.port, secure: settings.secure },
      requires: settings.host ? ['password'] : ['imapHost', 'password'],
      note: settings.note,
      confidence: settings.host ? 'high' : 'low',
      warnings: settings.host ? [] : ['无法自动识别 IMAP 服务器，请在添加后填写。'],
    }),
  );
  return results;
}

async function probeFeed(url, fallbackSection, extra = {}) {
  const response = await fetchProbe(url);
  const { items, feedTitle } = parseFeedXml(response.text);
  return base({
    type: 'rss',
    section: sectionFor(url, 'feed', fallbackSection),
    label: labelFor(url, feedTitle),
    url: response.finalUrl || url,
    confidence: items.length > 0 ? 'high' : 'low',
    note: items.length === 0 ? '订阅源暂时没有条目（仍可添加）' : '',
    preview: { title: feedTitle || hostOf(url), subtitle: hostOf(url), items: previewItems(items) },
    ...extra,
  });
}

async function probeIcs(url, fallbackSection) {
  const response = await fetchProbe(url);
  const parsed = await parseIcsText(response.text);
  const events = Object.values(parsed).filter((entry) => entry && entry.type === 'VEVENT');
  const upcoming = events
    .map((event) => ({ event, start: event.start instanceof Date ? event.start : null }))
    .filter((entry) => entry.start)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 12);
  return base({
    type: 'ics',
    section: fallbackSection ?? 'calendar',
    label: labelFor(url, ''),
    url: response.finalUrl || url,
    confidence: events.length > 0 ? 'high' : 'low',
    note: events.length === 0 ? '日历暂时没有事件' : `共 ${events.length} 个事件`,
    preview: {
      title: hostOf(url),
      subtitle: '日历订阅',
      items: upcoming.map(({ event }) => ({
        title: truncate(typeof event.summary === 'string' ? event.summary : event.summary?.val ?? '日程', 120),
        detail: '',
        date: event.start instanceof Date ? event.start.toISOString() : '',
      })),
    },
  });
}

async function probeJson(url, fallbackSection) {
  const response = await fetchProbe(url);
  let parsed;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return base({
      type: 'http',
      section: sectionFor(url, 'http', fallbackSection),
      label: labelFor(url, ''),
      url: response.finalUrl || url,
      warnings: ['返回内容不是有效 JSON，将按在线状态监控。'],
      preview: { title: hostOf(url), subtitle: `HTTP ${response.status}`, items: [] },
    });
  }
  const mapping = guessJsonMapping(parsed);
  let list = getByPath(parsed, mapping.items);
  if (!Array.isArray(list)) list = Array.isArray(parsed) ? parsed : [];
  const items = list
    .slice(0, 12)
    .map((entry) => ({
      title: String(getByPath(entry, mapping.title) ?? ''),
      detail: String(getByPath(entry, mapping.summary) ?? ''),
      date: String(getByPath(entry, mapping.date) ?? ''),
    }))
    .filter((entry) => entry.title !== '');
  return base({
    type: 'json',
    section: sectionFor(url, 'json', fallbackSection),
    label: labelFor(url, ''),
    url: response.finalUrl || url,
    options: { mapping },
    confidence: items.length > 0 ? 'high' : 'low',
    note: items.length > 0 ? `共 ${list.length} 条记录` : '没有自动识别到列表字段，可在添加后手动映射',
    preview: { title: hostOf(url), subtitle: 'JSON 接口', items: previewItems(items) },
  });
}

async function probeHtml(url, response, fallbackSection) {
  const root = parseHtml(response.text);
  const pageTitle = stripHtml(root.querySelector('title')?.textContent ?? '').trim();
  const description = root.querySelector('meta[name="description"]')?.getAttribute('content') ?? '';
  const feeds = discoverFeeds(response.text, response.finalUrl || url).slice(0, 4);
  if (feeds.length > 0) {
    try {
      const first = await probeFeed(feeds[0].url, fallbackSection, {});
      const extra = feeds.slice(1).map((feed) =>
        base({
          type: 'rss',
          section: sectionFor(feed.url, 'feed', fallbackSection),
          label: labelFor(feed.url, feed.title),
          url: feed.url,
          note: '页面中发现的订阅源',
          preview: { title: feed.title || hostOf(feed.url), subtitle: hostOf(feed.url), items: [] },
        }),
      );
      return [first, ...extra];
    } catch {
      /* fall through to page proposal */
    }
  }
  const links = extractLinks(response.text, response.finalUrl || url, { allowExternal: false }).slice(0, 4);
  // A monitor/panel page is better watched as a status probe: scraping it gives
  // a login screen or an empty shell, while the HTTP check still says "online".
  if (SERVER_HINTS.test(`${pageTitle} ${url} ${hostOf(url)}`.toLowerCase())) {
    return [
      base({
        type: 'http',
        section: fallbackSection ?? 'server',
        label: labelFor(url, pageTitle || '服务器监控'),
        url: response.finalUrl || url,
        options: { allowPrivate: isLocalHost(url) },
        confidence: 'medium',
        note: '服务器监控页：记录在线状态与响应时间。',
        preview: {
          title: pageTitle || hostOf(url),
          subtitle: `HTTP ${response.status} · 监控页`,
          items: [],
        },
      }),
    ];
  }
  return [
    base({
      type: 'page',
      section: sectionFor(url, 'page', fallbackSection),
      label: labelFor(url, pageTitle),
      url: response.finalUrl || url,
      confidence: links.length > 0 ? 'medium' : 'low',
      note: links.length > 0 ? '页面没有订阅源，将监控页面链接变化' : '页面没有订阅源，也没有识别到可监控的链接',
      warnings: links.length > 0 ? [] : ['可尝试在添加后设置 CSS 选择器'],
      preview: {
        title: pageTitle || hostOf(url),
        subtitle: description ? truncate(stripHtml(description), 100) : hostOf(url),
        items: previewItems(links.map((link) => ({ title: link.title, detail: link.meta, date: link.date }))),
      },
    }),
  ];
}

async function probeUrl(url, { section, forceType } = {}) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return { ok: false, raw: url, error: '不是有效的网址' };
  }
  if (!/^https?:$/.test(parsedUrl.protocol)) return { ok: false, raw: url, error: '仅支持 http/https 链接' };

  const host = parsedUrl.hostname.toLowerCase();
  const path = parsedUrl.pathname;

  if (forceType) {
    return base({
      type: forceType,
      section: section ?? sectionFor(url, forceType, undefined),
      label: labelFor(url, ''),
      url,
      confidence: 'low',
      note: '手动指定的来源类型（保存前请先测试）',
    });
  }

  // Product-specific shortcuts, matched before fetching.
  if (host === 'github.com') {
    const match = path.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (match) {
      const atom = `https://github.com/${match[1]}/${match[2]}/releases.atom`;
      try {
        return await probeFeed(atom, section ?? 'custom', { label: `${match[2]} Releases` });
      } catch {
        return base({
          type: 'rss',
          section: section ?? 'custom',
          label: `${match[2]} Releases`,
          url: atom,
          warnings: ['暂时无法读取 Releases，仍可添加后重试。'],
          preview: { title: `${match[1]}/${match[2]}`, subtitle: 'GitHub Releases', items: [] },
        });
      }
    }
  }

  if (host === 'store.steampowered.com') {
    const match = path.match(/^\/app\/(\d+)/);
    if (match) {
      // Steam 的 RSS 在部分地区会被拦截；官方新闻 API 更稳定，且能带出摘要。
      const api = `https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=${match[1]}&count=12&maxlength=400&format=json`;
      try {
        const proposal = await probeJson(api, section ?? 'gameNews');
        return {
          ...proposal,
          label: 'Steam 游戏新闻',
          note: proposal.note || 'Steam 官方新闻 API',
          preview: { ...proposal.preview, title: 'Steam 游戏新闻', subtitle: '官方新闻 API' },
        };
      } catch {
        return base({
          type: 'json',
          section: section ?? 'gameNews',
          label: 'Steam 游戏新闻',
          url: api,
          options: { mapping: { items: 'appnews.newsitems', title: 'title', url: 'url', date: 'date', summary: 'contents' } },
          warnings: ['暂时无法读取 Steam 新闻 API，添加后仍会每日重试。'],
          preview: { title: 'Steam', subtitle: '游戏新闻', items: [] },
        });
      }
    }
  }

  // Feishu / Lark: calendars export an ICS subscription link; docs and group
  // pages are front-end rendered, so they need a saved Cookie and a clear note.
  if (/(^|\.)(feishu\.cn|larksuite\.com|feishu\.net)$/i.test(host)) {
    if (/\.ics$/i.test(path) || /\.ics(\?|$)/i.test(url)) {
      return probeIcs(url, section ?? 'calendar').catch(() =>
        base({ type: 'ics', section: section ?? 'calendar', label: '飞书日历', url, requires: ['cookie'] }),
      );
    }
    if (/(^|\/)calendar\b/i.test(path)) {
      return base({
        type: 'page',
        section: section ?? 'calendar',
        label: '飞书日历',
        url,
        requires: ['cookie'],
        note: '飞书日程推荐在日历设置里复制「订阅链接」(ICS) 再粘贴；网页版需要登录 Cookie。',
        confidence: 'low',
        preview: { title: '飞书日历', subtitle: '日程订阅', items: [] },
      });
    }
    return base({
      type: 'page',
      section: section ?? 'feishu',
      label: /\/docx\//i.test(path) ? '飞书文档' : /\/wiki\//i.test(path) ? '飞书知识库' : '飞书',
      url,
      requires: ['cookie'],
      note: '飞书页面需要登录 Cookie；新版飞书多为前端渲染，若抓不到条目可改用「机器人推送」或日历 ICS。',
      confidence: 'low',
      preview: { title: '飞书', subtitle: '登录后可读取', items: [] },
    });
  }

  if (/(^|\.)managebac\.(com|cn|com\.cn|net|org)$/i.test(host)) {
    if (/\.ics$/i.test(path) || /calendar/i.test(path)) {
      return probeIcs(url, 'managebac').catch(() =>
        base(
          {
            type: 'ics',
            section: section ?? 'managebac',
            label: 'ManageBac 日历',
            url,
            requires: [],
            note: '日历订阅链接通常自带访问口令，直接读取即可。',
            preview: { title: 'ManageBac', subtitle: '日历订阅', items: [] },
          },
        ),
      );
    }
    return base({
      type: 'managebac',
      section: section ?? 'managebac',
      label: 'ManageBac',
      url,
      requires: ['cookie'],
      note: '需要：学校 ManageBac 地址 + 登录 Cookie（浏览器 F12 → Network → 任意请求 → 复制 cookie 请求头）。也可以改用班级日历的 ICS 订阅链接。',
      preview: { title: 'ManageBac', subtitle: '通知与班级动态', items: [] },
    });
  }

  if (/(^|\.)to-do\.office\.com$/i.test(host)) {
    return base({
      type: 'graph',
      section: 'tasks',
      label: 'Microsoft To Do',
      account: { user: '', host: '', port: 993, secure: true },
      requires: ['microsoft'],
      note: '将读取未完成的 To Do 任务。',
      confidence: 'high',
    });
  }
  if (/(^|\.)(outlook\.office\.com|outlook\.live\.com|outlook\.com)$/i.test(host)) {
    const calendar = /calendar/i.test(path);
    return base({
      type: 'graph',
      section: section ?? (calendar ? 'calendar' : 'mail'),
      label: calendar ? 'Outlook 日历' : 'Outlook 收件箱',
      account: { user: '', host: '', port: 993, secure: true },
      requires: ['microsoft'],
      note: '将读取 Microsoft 365 数据。',
      confidence: 'high',
    });
  }
  if (host === 'calendar.google.com' && /\/ical\//i.test(path)) {
    return probeIcs(url, 'calendar').catch(() => base({ type: 'ics', section: 'calendar', label: 'Google 日历', url }));
  }
  if (/\.ics$/i.test(path) || /\.ics(\?|$)/i.test(url)) {
    try {
      return await probeIcs(url, section);
    } catch (error) {
      return base({
        type: 'ics',
        section: section ?? 'calendar',
        label: labelFor(url, ''),
        url,
        warnings: [`读取日历失败：${error instanceof Error ? error.message : String(error)}`],
        confidence: 'low',
      });
    }
  }

  let response;
  try {
    response = await fetchProbe(url);
  } catch (error) {
    const monitor = SERVER_HINTS.test(`${host} ${url}`.toLowerCase()) || isLocalHost(url);
    return base({
      type: 'http',
      section: section ?? (monitor ? 'server' : 'custom'),
      label: labelFor(url, host),
      url,
      options: { allowPrivate: isLocalHost(url) },
      warnings: [`无法访问（${error instanceof Error ? error.message : String(error)}），仍可添加为状态监控。`],
      requires: [],
      confidence: 'low',
      preview: { title: host, subtitle: '状态监控', items: [] },
    });
  }

  const contentType = (response.contentType ?? '').toLowerCase();
  const text = response.text;
  if (contentType.includes('rss') || contentType.includes('atom') || /<(rss|feed|rdf:RDF)[\s>]/i.test(text.slice(0, 1200))) {
    try {
      const { items, feedTitle } = parseFeedXml(text);
      return base({
        type: 'rss',
        section: sectionFor(url, 'feed', section),
        label: labelFor(url, feedTitle),
        url: response.finalUrl || url,
        confidence: items.length > 0 ? 'high' : 'low',
        preview: { title: feedTitle || host, subtitle: host, items: previewItems(items) },
      });
    } catch {
      /* fall through */
    }
  }
  if (contentType.includes('calendar') || /BEGIN:VCALENDAR/i.test(text.slice(0, 200))) {
    try {
      return await probeIcs(url, section);
    } catch {
      /* fall through */
    }
  }
  if (contentType.includes('json') || /^\s*[[{]/.test(text)) {
    try {
      return await probeJson(url, section);
    } catch {
      /* fall through */
    }
  }
  if (contentType.includes('html') || /^\s*<(!doctype|html)/i.test(text)) {
    return probeHtml(url, response, section);
  }
  return base({
    type: 'http',
    section: sectionFor(url, 'http', section),
    label: labelFor(url, host),
    url: response.finalUrl || url,
    options: { allowPrivate: isLocalHost(url) },
    note: `HTTP ${response.status} · ${(response.elapsedMs / 1000).toFixed(2)}s`,
    preview: { title: host, subtitle: `HTTP ${response.status}`, items: [] },
    confidence: 'medium',
  });
}

export async function probeMany(raw, options = {}) {
  const text = String(raw ?? '').trim();
  if (text === '') return { results: [], errors: ['请输入网址、邮箱地址或 OPML 内容'] };

  if (/<opml[\s>]/i.test(text)) {
    const entries = parseOpml(text);
    if (entries.length === 0) return { results: [], errors: ['OPML 中没有找到订阅源'] };
    const selected = entries.slice(0, 12);
    const results = await Promise.all(
      selected.map(async (entry) => {
        try {
          return await probeFeed(entry.url, options.section, { label: entry.title || labelFor(entry.url, '') });
        } catch {
          return base({
            type: 'rss',
            section: options.section ?? 'custom',
            label: entry.title || labelFor(entry.url, ''),
            url: entry.url,
            warnings: ['暂时无法读取该订阅源'],
            confidence: 'low',
            preview: { title: entry.title || hostOf(entry.url), subtitle: hostOf(entry.url), items: [] },
          });
        }
      }),
    );
    return { results, errors: [] };
  }

  const inputs = splitInputs(text);
  const results = [];
  const errors = [];
  for (const input of inputs) {
    if (isEmail(input)) {
      results.push(...emailProposals(input));
      continue;
    }
    const server = /^(?:minecraft:\/\/)?(\[[0-9a-f:]+\]|[a-z0-9][a-z0-9.-]*\.[a-z]{2,}|localhost|(?:\d{1,3}\.){3}\d{1,3})(?::(\d{1,5}))?$/i.exec(
      input,
    );
    if (server) {
      const host = server[1].replace(/^\[|\]$/g, '');
      const port = server[2] ? Number(server[2]) : null;
      const explicit = /^minecraft:\/\//i.test(input);
      const sureMinecraft = explicit || port === null || port === 25565;
      results.push(
        base({
          type: 'minecraft',
          section: 'server',
          label: '我的世界服务器',
          options: { host, port: port || 25565 },
          confidence: sureMinecraft ? 'high' : 'low',
          note: sureMinecraft ? '会直接查询服务器状态（Java 版协议）。' : '如果这是 Minecraft 服务器就选这条；否则选下面的监控地址。',
          preview: { title: host, subtitle: `端口 ${port || 25565}`, items: [] },
        }),
      );
      if (!explicit) {
        // "1.2.3.4:8080" is just as often a panel or status page as a game
        // server, so offer both instead of guessing one.
        results.push(
          base({
            type: 'http',
            section: 'server',
            label: '服务器监控',
            url: `http://${host}${port ? `:${port}` : ''}/`,
            options: { allowPrivate: isPrivateIp(host) },
            confidence: 'low',
            note: '按网址检查在线状态与响应时间；如果这是面板或监控页，选这一条。',
            preview: { title: host, subtitle: '状态监控', items: [] },
          }),
        );
      }
      continue;
    }
    if (!/^https?:\/\//i.test(input)) {
      errors.push(`无法识别：${truncate(input, 80)}（请输入 http/https 网址、IP 地址、服务器地址或邮箱地址）`);
      continue;
    }
    const result = await probeUrl(input, options);
    if (Array.isArray(result)) {
      results.push(...result);
    } else if (result?.ok === false) {
      errors.push(result.error ?? '无法识别该链接');
    } else if (result) {
      results.push(result);
    }
  }
  return { results, errors };
}

export { probeUrl };
