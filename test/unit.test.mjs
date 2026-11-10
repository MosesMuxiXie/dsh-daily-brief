import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseFeedXml } from '../lib/engine/collect/feed.js';
import { guessJsonMapping, getByPath } from '../lib/engine/collect/json.js';
import { applyAiPolish, buildBriefing } from '../lib/engine/render/model.js';
import { renderBriefingHtml } from '../lib/engine/render/html.js';
import { defaultConfig, mergeConfig, personaFor, SECTION_DEFS } from '../lib/engine/config.js';
import { splitInputs, guessMailSettings, probeMany, normalizeCalendarLink, calendarLike } from '../lib/engine/import/detect.js';
import { selectIcsEvents } from '../lib/engine/collect/ics.js';
import { parseYouTubeUrl } from '../lib/engine/collect/youtube.js';
import { parseBilibiliUrl } from '../lib/engine/collect/bilibili.js';
import { extractArticle, pageKind } from '../lib/engine/collect/page.js';
import { relativeTime } from '../lib/engine/text.js';

test('parses RSS 2.0 and Atom without namespace assumptions', () => {
  const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>示例</title>
    <item><title>第一条</title><link>https://example.com/a</link><pubDate>Sun, 08 Nov 2026 08:00:00 GMT</pubDate></item>
    <item><title>第二条</title><link>https://example.com/b</link></item>
  </channel></rss>`;
  const parsed = parseFeedXml(rss);
  assert.equal(parsed.feedTitle, '示例');
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].title, '第一条');
  assert.equal(parsed.items[0].url, 'https://example.com/a');

  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 源</title>
    <entry><title>Hello</title><link rel="alternate" href="https://example.com/hello"/><updated>2026-11-08T08:00:00Z</updated></entry>
  </feed>`;
  const atomParsed = parseFeedXml(atom);
  assert.equal(atomParsed.items.length, 1);
  assert.equal(atomParsed.items[0].url, 'https://example.com/hello');
});

test('recognizes Steam news API mapping and unix-second dates', () => {
  const sample = {
    appnews: {
      newsitems: [
        { gid: '1', title: 'Update', url: 'https://store.steampowered.com/news/1', contents: '\\Bomb defusal', date: 1762500000 },
      ],
    },
  };
  const mapping = guessJsonMapping(sample);
  assert.equal(mapping.items, 'appnews.newsitems');
  assert.equal(mapping.summary, 'contents');
  assert.equal(getByPath(sample, mapping.items).length, 1);
});

test('AI polish keeps the persona greeting and strips duplicated greetings', () => {
  const briefing = {
    headline: '本地标题',
    greeting: '晚上好，这是今天的简报。',
    sections: [{ id: 'aiNews', zh: 'AI 新闻' }],
  };
  const next = applyAiPolish(briefing, {
    headline: '晚上好：AI 与游戏速览',
    intro: '晚上好，今天值得看看这几条。',
    sections: { aiNews: '提示' },
  });
  assert.equal(next.greeting, '晚上好，这是今天的简报。');
  assert.equal(next.headline, 'AI 与游戏速览');
  assert.equal(next.ai.intro, '今天值得看看这几条');
  assert.equal(next.sections[0].aiNote, '提示');
});

test('ai points extract short lines instead of links', () => {
  const config = defaultConfig();
  const makeItems = (prefix, count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`,
      title: `${prefix} 标题 ${index}`,
      detail: '',
      url: `https://example.com/${prefix}/${index}`,
      date: new Date(Date.UTC(2026, 10, 8, index)).toISOString(),
      meta: '',
      badge: '',
      tone: '',
    }));
  const briefing = buildBriefing({
    config,
    dateKey: '2026-11-08',
    results: [
      { source: { id: 'x-openai', label: 'OpenAI', section: 'aiNews', enabled: true }, result: { status: 'ok', items: makeItems('ai', 3), note: '' } },
      { source: { id: 'steam-1', label: 'Game', section: 'gameNews', enabled: true }, result: { status: 'ok', items: makeItems('game', 2), note: '' } },
    ],
  });
  const ai = briefing.sections.find((section) => section.id === 'aiNews');
  assert.ok(ai.points.includes('ai 标题 0'));
  assert.equal(ai.digest, '');

  const polished = applyAiPolish(briefing, {
    points: {
      aiNews: [
        'OpenAI 更新了智能体记忆机制，重点放在长期上下文',
        'Anthropic 让 Claude 参与 MMORPG 实验',
        'Google DeepMind 公布新的机器人学习成果',
      ],
      gameNews: ['坦克世界闪击战上线花桥行动', 'K-70 活动持续到月底'],
    },
  });
  const aiAfter = polished.sections.find((section) => section.id === 'aiNews');
  assert.deepEqual(aiAfter.points, [
    'OpenAI 更新了智能体记忆机制，重点放在长期上下文',
    'Anthropic 让 Claude 参与 MMORPG 实验',
    'Google DeepMind 公布新的机器人学习成果',
  ]);
  const html = renderBriefingHtml(polished);
  assert.match(html, /<ul class="points">/);
  assert.equal((html.match(/<a /g) || []).length, 0);
});

test('a short AI answer falls back to every collected item', () => {
  const config = defaultConfig();
  const items = [0, 1, 2].map((index) => ({
    id: `item-${index}`,
    title: `第 ${index} 条事件`,
    url: `https://example.com/${index}`,
    date: new Date(Date.UTC(2026, 10, 8, index)).toISOString(),
  }));
  const briefing = buildBriefing({
    config,
    dateKey: '2026-11-08',
    results: [{ source: { id: 'feed', label: 'Feed', section: 'aiNews', enabled: true }, result: { status: 'ok', items, note: '' } }],
  });
  const polished = applyAiPolish(briefing, {
    points: { aiNews: ['模型只写了两条要点', '第二条要点仍然很短'] },
  });
  const section = polished.sections.find((entry) => entry.id === 'aiNews');
  assert.equal(section.points.length, 3);
  for (const item of items) assert.ok(section.points.includes(item.title), item.title);
});

test('import helpers split lines and suggest IMAP settings', () => {
  const lines = splitInputs('https://example.com/feed\n\nyou@gmail.com\nhttps://example.com/feed');
  assert.deepEqual(lines, ['https://example.com/feed', 'you@gmail.com']);
  const mail = guessMailSettings('you@gmail.com');
  assert.equal(mail.host, 'imap.gmail.com');
  assert.equal(mail.port, 993);
});

test('Outlook mailboxes get a forwarding guide instead of an Azure requirement', async () => {
  for (const address of ['me@outlook.com', 'me@hotmail.com', 'me@live.cn', 'me@msn.com']) {
    const { results, errors } = await probeMany(address);
    assert.deepEqual(errors, [], address);
    assert.equal(results.length, 1, address);
    const [proposal] = results;
    assert.equal(proposal.type, 'guide', address);
    assert.equal(proposal.section, 'mail', address);
    assert.equal(proposal.addable, false, address);
    assert.deepEqual(proposal.requires, [], address);
    assert.equal(proposal.steps.length, 3, address);
    assert.match(proposal.note, /转发/);
    assert.match(proposal.note, /Gmail|QQ/);
    assert.equal(proposal.links[0].url, 'https://outlook.live.com/mail/0/options/mail/forwarding');
  }
  const gmail = await probeMany('you@gmail.com');
  assert.deepEqual(gmail.errors, []);
  assert.equal(gmail.results.length, 1);
  assert.equal(gmail.results[0].type, 'imap');
  assert.equal(gmail.results[0].account.host, 'imap.gmail.com');
});

test('briefing keeps every collected item instead of capping at ten', () => {
  const config = defaultConfig();
  const makeItems = (prefix, count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`,
      title: `${prefix} ${index}`,
      detail: '',
      url: `https://example.com/${prefix}/${index}`,
      date: new Date(Date.UTC(2026, 10, 8, index)).toISOString(),
      meta: '',
      badge: '',
      tone: '',
    }));
  const results = [
    { source: { id: 'x-openai', label: 'OpenAI', section: 'aiNews', enabled: true }, result: { status: 'ok', items: makeItems('ai', 12), note: '' } },
    { source: { id: 'steam-1', label: 'Game', section: 'gameNews', enabled: true }, result: { status: 'ok', items: makeItems('game', 8), note: '' } },
    {
      source: { id: 'mc-main', label: 'MC', section: 'server', enabled: true },
      result: {
        status: 'ok',
        items: [{ id: 'mc', title: '服务器在线', date: new Date().toISOString(), badge: '在线', tone: 'good', meta: '' }],
        note: '',
        server: { online: true, host: 'play.simpfun.cn', port: 11848, address: 'play.simpfun.cn:11848', label: '我的世界服务器', players: { online: 1, max: 10 } },
      },
    },
  ];
  const briefing = buildBriefing({ config, results, dateKey: '2026-11-08' });
  assert.equal(briefing.stats.items, 20);
  assert.equal(briefing.sections.find((section) => section.id === 'aiNews').items.length, 12);
  assert.equal(briefing.sections.find((section) => section.id === 'gameNews').items.length, 8);
  assert.equal(briefing.sections.find((section) => section.id === 'server').server.online, true);
  assert.match(briefing.headline, /12 条新闻/);
  assert.match(briefing.headline, /8 条游戏/);
});

test('school notices are shown in full without taking a seat budget', () => {
  const config = defaultConfig();
  const makeItems = (prefix, count) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`,
      title: `${prefix} ${index}`,
      detail: '',
      url: `https://example.com/${prefix}/${index}`,
      date: new Date(Date.UTC(2026, 10, 8, index)).toISOString(),
      meta: '',
      badge: '',
      tone: '',
    }));
  const results = [
    { source: { id: 'x-openai', label: 'OpenAI', section: 'aiNews', enabled: true }, result: { status: 'ok', items: makeItems('ai', 6), note: '' } },
    { source: { id: 'steam-1', label: 'Game', section: 'gameNews', enabled: true }, result: { status: 'ok', items: makeItems('game', 4), note: '' } },
    { source: { id: 'mb-1', label: 'ManageBac', section: 'managebac', enabled: true }, result: { status: 'ok', items: makeItems('school', 2), note: '' } },
    { source: { id: 'imap-1', label: '邮箱', section: 'mail', enabled: true }, result: { status: 'ok', items: makeItems('mail', 2), note: '' } },
  ];
  const briefing = buildBriefing({ config, results, dateKey: '2026-11-08' });
  assert.equal(briefing.stats.items, 14);
  const school = briefing.sections.find((section) => section.id === 'managebac');
  assert.equal(school.items.length, 2, 'every school notice should be shown');
  assert.equal(briefing.sections.find((section) => section.id === 'aiNews').items.length, 6);
  assert.equal(briefing.sections.find((section) => section.id === 'mail').items.length, 2);
  assert.match(briefing.headline, /其他更新/);
});

test('v1 config migration keeps hand-added sources and drops old presets', () => {
  const migrated = mergeConfig({
    version: 1,
    sources: [
      { id: 'preset-ai-hn', type: 'rss', section: 'aiNews', label: 'Hacker News', enabled: true, url: 'https://hnrss.org/frontpage' },
      { id: 'custom-mine', type: 'rss', section: 'custom', label: '我的订阅', enabled: true, url: 'https://example.com/feed' },
    ],
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.sources.some((source) => source.id === 'preset-ai-hn'), false);
  assert.equal(migrated.sources.some((source) => source.type === 'x'), false);
  assert.equal(migrated.sources.some((source) => source.type === 'steam'), false);
  assert.equal(migrated.sources.some((source) => source.type === 'minecraft'), false);
  assert.equal(migrated.sources.some((source) => source.id === 'custom-mine'), true);
  assert.equal(migrated.delivery.popup.enabled, true);
  assert.equal(migrated.delivery.toast, undefined);
});

test('a fresh install starts with no sources until the user pastes ids', () => {
  assert.equal(defaultConfig().sources.length, 0);
});

test('pasted x handles become news sources', async () => {
  const { results, errors } = await probeMany('@OpenAI\nAnthropicAI');
  assert.equal(errors.length, 0);
  assert.equal(results.length, 2);
  for (const row of results) {
    assert.equal(row.type, 'x');
    assert.equal(row.section, 'aiNews');
  }
  assert.deepEqual(
    results.map((row) => row.options.handle),
    ['OpenAI', 'AnthropicAI'],
  );
});

test('news is a general section instead of an AI-only bucket', () => {
  const news = SECTION_DEFS.find((section) => section.id === 'aiNews');
  assert.equal(news.zh, '新闻');
  assert.equal(news.en, 'News');

  for (const type of ['rss', 'atom', 'json', 'page']) {
    const config = mergeConfig({ sources: [{ type, label: type, url: 'https://example.com/feed' }] });
    assert.equal(config.sources[0].section, 'aiNews', `${type} should default to news`);
  }

  const gamefeed = mergeConfig({ sources: [{ type: 'steam', label: 'Game', options: { appid: '502500' } }] });
  assert.equal(gamefeed.sources[0].section, 'gameNews');
});

test('custom persona fields clamp to the editor limits', () => {
  const config = mergeConfig({
    persona: {
      preset: 'custom',
      customName: '名'.repeat(40),
      customTagline: '签'.repeat(80),
      customPrompt: '语'.repeat(2100),
      customAccent: '#GGGGGG',
    },
  });
  assert.equal(config.persona.customName.length, 24);
  assert.equal(config.persona.customTagline.length, 60);
  assert.equal(config.persona.customPrompt.length, 2000);
  assert.equal(config.persona.customAccent, '');
});

test('quiet focus sections hand spare rows to mail and school updates', () => {
  const config = defaultConfig();
  const makeItems = (prefix, count, day = 8) =>
    Array.from({ length: count }, (_, index) => ({
      id: `${prefix}-${index}`,
      title: `${prefix} ${index}`,
      detail: '',
      url: `https://example.com/${prefix}/${index}`,
      date: new Date(Date.UTC(2026, 10, day, index)).toISOString(),
      meta: '',
      badge: '',
      tone: '',
    }));
  const results = [
    { source: { id: 'x-openai', label: 'OpenAI', section: 'aiNews', enabled: true }, result: { status: 'ok', items: makeItems('ai', 1), note: '' } },
    { source: { id: 'steam-1', label: 'Game', section: 'gameNews', enabled: true }, result: { status: 'ok', items: makeItems('game', 1), note: '' } },
    { source: { id: 'imap-1', label: '邮箱', section: 'mail', enabled: true }, result: { status: 'ok', items: makeItems('mail', 3, 8), note: '' } },
    { source: { id: 'mb-1', label: 'ManageBac', section: 'managebac', enabled: false }, result: { status: 'ok', items: makeItems('mb', 2, 7), note: '' } },
  ];
  const briefing = buildBriefing({ config, results, dateKey: '2026-11-08' });
  assert.equal(briefing.stats.items, 5);
  const mail = briefing.sections.find((section) => section.id === 'mail');
  assert.ok(mail, 'mail section should appear when it takes the spare rows');
  assert.ok(mail.items.length >= 2);
  assert.match(briefing.headline, /新闻|游戏|其他/);
});

test('relative time never claims a future minute for a just-now item', () => {
  const now = new Date('2026-11-08T13:05:00.000Z');
  assert.equal(relativeTime(new Date('2026-11-08T13:05:20.000Z'), now), '刚刚');
  assert.equal(relativeTime(new Date('2026-11-08T13:04:40.000Z'), now), '刚刚');
  assert.equal(relativeTime(new Date('2026-11-08T11:05:00.000Z'), now), '2 小时前');
  assert.equal(relativeTime(new Date('2026-11-08T15:05:00.000Z'), now), '2 小时后');
});

test('server strip keeps every monitored server without spending news rows', () => {
  const config = mergeConfig({
    sources: [
      { id: 'mc-main', type: 'minecraft', section: 'server', label: '我的世界服务器', options: { host: 'play.simpfun.cn', port: 11848 } },
      { id: 'monitor', type: 'http', section: 'server', label: 'IHC 服务器监控', url: 'http://af.rainplay.cn:44825/' },
    ],
  });
  const results = [
    {
      source: config.sources.find((source) => source.id === 'mc-main'),
      result: {
        status: 'ok',
        note: '',
        items: [{ title: '服务器离线', badge: '离线', tone: 'bad', detail: '服务器当前没有开服', date: '2026-11-08T12:00:00Z' }],
        server: { online: false, host: 'play.simpfun.cn', port: 11848, address: 'play.simpfun.cn:11848', label: '我的世界服务器' },
      },
    },
    {
      source: config.sources.find((source) => source.id === 'monitor'),
      result: {
        status: 'ok',
        note: '',
        items: [{ title: 'IHC 服务器监控 运行正常', badge: '在线', tone: 'good', detail: 'HTTP 200 · 0.09s', date: '2026-11-08T12:00:00Z' }],
      },
    },
  ];
  const briefing = buildBriefing({ config, results, dateKey: '2026-11-08' });
  const server = briefing.sections.find((section) => section.id === 'server');
  assert.equal(server.items.length, 2);
  assert.equal(briefing.stats.items, 0);
  assert.match(server.items.map((item) => item.title).join(','), /IHC/);
});

test('custom persona cards are saved, normalized and selectable', () => {
  const config = mergeConfig({
    persona: {
      preset: 'card-b',
      cards: [
        { id: 'card-a', name: '深夜电台', tagline: '慢慢说', accent: '#123456', prompt: '像电台主播' },
        { id: 'custom', name: '想用内置 id', accent: '#abcdef' },
        { id: 'card-b', name: '早报', tagline: '干脆', accent: '#zzzzzz', prompt: '像记者' },
        { id: 'card-empty', name: '  ', tagline: '', prompt: '' },
      ],
    },
  });
  assert.equal(config.persona.preset, 'card-b');
  assert.equal(config.persona.cards.length, 3);
  assert.notEqual(config.persona.cards[1].id, 'custom');
  assert.equal(config.persona.cards[0].name, '深夜电台');
  assert.equal(config.persona.cards[0].accent, '#123456');
  assert.equal(config.persona.cards[2].accent, '');
  const persona = personaFor(config);
  assert.equal(persona.id, 'card-b');
  assert.equal(persona.zh, '早报');
  assert.equal(persona.tagline, '干脆');
  assert.equal(persona.prompt, '像记者');
});

test('persona cards are capped and fall back when the preset is unknown', () => {
  const cards = Array.from({ length: 14 }, (_, index) => ({
    id: `card-${index + 1}`,
    name: `卡片 ${index + 1}`,
    tagline: '',
    accent: '#123456',
    prompt: '',
  }));
  const config = mergeConfig({ persona: { preset: 'missing', cards } });
  assert.equal(config.persona.cards.length, 12);
  assert.equal(config.persona.preset, 'whale');
});

test('persona cards keep legacy presets and read the custom slot', () => {
  const legacy = mergeConfig({ persona: { preset: 'warm' } });
  assert.equal(legacy.persona.preset, 'whale');
  assert.equal(personaFor(legacy).id, 'whale');
  assert.equal(personaFor(legacy).accent, '#4aa8ff');

  const custom = mergeConfig({
    persona: { preset: 'custom', customName: '深夜电台', customTagline: '慢慢说', customAccent: '#123456', customPrompt: '像电台主播' },
  });
  const persona = personaFor(custom);
  assert.equal(persona.id, 'custom');
  assert.equal(persona.zh, '深夜电台');
  assert.equal(persona.accent, '#123456');
  assert.equal(persona.prompt, '像电台主播');
});

test('minecraft address is recognized with and without a scheme', async () => {
  const bare = await probeMany('play.example.com:25565', {});
  assert.equal(bare.results.length, 2);
  assert.equal(bare.results[0].type, 'minecraft');
  assert.equal(bare.results[0].options.host, 'play.example.com');
  assert.equal(bare.results[0].options.port, 25565);
  assert.equal(bare.results[1].type, 'http');
  assert.equal(bare.results[1].section, 'server');
  assert.match(bare.results[1].url, /^http:\/\/play\.example\.com:25565/);
  const scheme = await probeMany('minecraft://mc.example.net', {});
  assert.equal(scheme.results[0].type, 'minecraft');
  assert.equal(scheme.results[0].options.port, 25565);
});

test('ip addresses and monitor pages are addable as server sources', async () => {
  const ip = await probeMany('192.168.1.20:8123', {});
  assert.ok(ip.results.length >= 2);
  const monitor = ip.results.find((row) => row.type === 'http');
  assert.ok(monitor, 'a bare ip:port also offers an HTTP monitor row');
  assert.equal(monitor.section, 'server');
  assert.equal(monitor.options.allowPrivate, true);
  assert.equal(monitor.url, 'http://192.168.1.20:8123/');
  assert.equal(ip.errors.length, 0);

  const privateUrl = await probeMany('http://127.0.0.1:9/status', {});
  assert.equal(privateUrl.results[0].section, 'server');
  assert.equal(privateUrl.results[0].options.allowPrivate, true);
});

test('managebac domains on .cn and school subdomains are recognized', async () => {
  for (const input of [
    'https://www.managebac.com/student/',
    'https://www.managebac.cn/student/',
    'https://school.managebac.cn/student/notifications',
  ]) {
    const out = await probeMany(input, {});
    const row = out.results[0];
    assert.equal(row.type, 'managebac', `${input} is recognized as ManageBac`);
    assert.equal(row.section, 'managebac');
    assert.deepEqual(row.requires, ['cookie']);
    assert.match(row.note, /Cookie|ICS/);
  }
});


test('calendar subscription links survive webcal and are recognized as ICS', () => {
  assert.equal(normalizeCalendarLink('webcal://example.com/cal.ics'), 'https://example.com/cal.ics');
  assert.equal(normalizeCalendarLink(' WEBCAL://example.com/cal.ics'), 'https://example.com/cal.ics');
  assert.equal(normalizeCalendarLink('https://example.com/cal.ics'), 'https://example.com/cal.ics');
  assert.ok(calendarLike('https://example.com/team.ics', '/team.ics'));
  assert.ok(calendarLike('https://calendar.google.com/calendar/ical/a/basic.ics', '/calendar/ical/a/basic.ics'));
  assert.ok(calendarLike('https://example.com/ical/feed', '/ical/feed'));
  assert.ok(!calendarLike('https://example.com/feed.xml', '/feed.xml'));
});

test('calendar events weeks ahead still make it into the brief', () => {
  const now = Date.UTC(2026, 10, 9, 0, 0, 0);
  const event = (title, days) => ({
    type: 'VEVENT',
    uid: title,
    summary: { val: title },
    start: new Date(now + days * 86400000),
    end: new Date(now + days * 86400000 + 3600000),
  });
  const parsed = {
    a: event('家长会', 1),
    b: event('月度活动', 20),
    c: event('远期考试', 90),
  };
  const near = selectIcsEvents(parsed, { now, daysAhead: 30, timezone: 'Asia/Shanghai' });
  assert.deepEqual(near.map((item) => item.title), ['家长会', '月度活动']);
  const wide = selectIcsEvents(parsed, { now, daysAhead: 120, timezone: 'Asia/Shanghai' });
  assert.deepEqual(wide.map((item) => item.title), ['家长会', '月度活动', '远期考试']);
});

test('YouTube links resolve to channel, video and playlist sources', () => {
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/@mkbhd'), { mode: 'channel', handle: 'mkbhd' });
  assert.deepEqual(parseYouTubeUrl('https://youtube.com/channel/UCBcRF18a7Qf58cCRy5xuWwQ'), {
    mode: 'channel',
    channelId: 'UCBcRF18a7Qf58cCRy5xuWwQ',
  });
  assert.deepEqual(parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), {
    mode: 'video',
    videoId: 'dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), {
    mode: 'video',
    videoId: 'dQw4w9WgXcQ',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  });
  assert.deepEqual(parseYouTubeUrl('https://www.youtube.com/playlist?list=PL123'), {
    mode: 'playlist',
    playlistId: 'PL123',
  });
  assert.equal(parseYouTubeUrl('https://example.com/watch?v=1'), null);
});

test('Bilibili links resolve to space, video, ranking and short sources', () => {
  assert.deepEqual(parseBilibiliUrl('https://space.bilibili.com/2'), { mode: 'space', mid: '2' });
  assert.deepEqual(parseBilibiliUrl('https://www.bilibili.com/video/BV1GJ411x7h7'), {
    mode: 'video',
    bvid: 'BV1GJ411x7h7',
  });
  assert.deepEqual(parseBilibiliUrl('https://www.bilibili.com/video/av170001'), { mode: 'video', aid: '170001' });
  assert.deepEqual(parseBilibiliUrl('https://www.bilibili.com/v/popular/rank/all'), { mode: 'ranking' });
  assert.deepEqual(parseBilibiliUrl('https://b23.tv/abc123'), { mode: 'short', shortUrl: 'https://b23.tv/abc123' });
  assert.equal(parseBilibiliUrl('https://example.com/video/BV1GJ411x7h7'), null);
});

test('ordinary article pages expose title, body and publish time', () => {
  const html = `<!doctype html><html><head>
    <meta property="og:type" content="article">
    <meta property="og:title" content="A long article title">
    <meta property="og:description" content="A useful summary of what changed today.">
    <meta property="article:published_time" content="2026-11-08T08:00:00Z">
    <link rel="canonical" href="https://example.com/posts/1">
  </head><body><article><h1>A long article title</h1><p>Body paragraph.</p></article></body></html>`;
  assert.equal(pageKind(html), 'article');
  const item = extractArticle(html, 'https://example.com/posts/1');
  assert.equal(item.title, 'A long article title');
  assert.equal(item.url, 'https://example.com/posts/1');
  assert.match(item.detail, /useful summary/);
  assert.equal(item.date, '2026-11-08T08:00:00.000Z');
  assert.equal(pageKind('<html><body><ul><li><a href="/a">link one</a></li></ul></body></html>'), 'list');
});

test('scheme-less web addresses are probed as pages', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/sspai\.com\//);
    return new Response(
      `<html><head><title>sspai</title>
       <meta property="og:type" content="article">
       <meta property="og:title" content="A pasted page title that is long enough">
       <meta property="article:published_time" content="2026-11-08T00:00:00Z">
       </head><body><article><p>Hello world.</p></article></body></html>`,
      { status: 200, headers: { 'content-type': 'text/html' } },
    );
  };
  try {
    const { results, errors } = await probeMany('sspai.com/', {});
    assert.deepEqual(errors, []);
    assert.equal(results.length, 1);
    assert.equal(results[0].type, 'page');
    assert.equal(results[0].url, 'https://sspai.com/');
  } finally {
    globalThis.fetch = original;
  }
});

test('Outlook calendar URLs become a publish-guide instead of a Graph source', async () => {
  const { results, errors } = await probeMany('https://outlook.live.com/calendar/0/view/month');
  assert.deepEqual(errors, []);
  assert.equal(results.length, 1);
  assert.equal(results[0].type, 'guide');
  assert.equal(results[0].section, 'calendar');
  assert.equal(results[0].addable, false);
  assert.match(results[0].note, /日历|ICS/);
  assert.equal(results[0].links[0].url, 'https://outlook.live.com/calendar/0/options/calendar/publishing');
});

test('AI polish keeps every point instead of trimming to six', () => {
  const config = defaultConfig();
  const briefing = buildBriefing({
    config,
    results: [
      {
        source: { id: 'x-openai', label: 'OpenAI', section: 'aiNews', enabled: true },
        result: {
          status: 'ok',
          items: Array.from({ length: 10 }, (_, index) => ({
            id: `ai-${index}`,
            title: `OpenAI 更新 ${index}`,
            detail: '',
            url: `https://example.com/ai/${index}`,
            date: new Date(Date.UTC(2026, 10, 8, index)).toISOString(),
            meta: '',
            badge: '',
            tone: '',
          })),
          note: '',
        },
      },
    ],
    dateKey: '2026-11-08',
  });
  const points = Array.from({ length: 10 }, (_, index) => `第 ${index} 条要点`);
  const polished = applyAiPolish(briefing, { headline: '', intro: '', points: { aiNews: points } });
  const ai = polished.sections.find((section) => section.id === 'aiNews');
  assert.equal(ai.points.length, 10);
});

test('the panel catches render errors and never passes string style props', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  // React error #62 (style must be an object) crashed the whole panel once.
  assert.doesNotMatch(source, /\bstyle\s*:\s*['"]/);
  // A function component cannot catch render errors; the panel needs a real boundary.
  assert.match(source, /class Boundary extends React\.Component/);
  assert.match(source, /class RowBoundary extends React\.Component/);
  assert.match(source, /static getDerivedStateFromError/);
  assert.match(source, /componentDidCatch/);
});

test('the panel paints the last snapshot before the host answers', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  // A cold panel used to sit on the skeleton until /state finished; even after
  // the host got faster, a cached first paint keeps reopening instant.
  assert.match(source, /daily-brief:panel-state:v1/);
  assert.match(source, /useState\(\(\) => cachedState\)/);
  assert.match(source, /rememberState\(next\)/);
});

test('the panel only turns translucent while a wallpaper or glass layer is active', () => {
  const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8');
  assert.match(source, /body:is\(\[data-we-wallpaper\],\[data-we-glass-page\]\) \.dbp-root \{ background:transparent; \}/);
  assert.match(source, /backdrop-filter:blur\(var\(--we-blur,18px\)\)/);
  assert.match(source, /@media \(prefers-reduced-transparency: reduce\)/);
});

test('opening the panel never waits for the PowerShell task probe', () => {
  const source = readFileSync(new URL('../lib/host/service.js', import.meta.url), 'utf8');
  // getState() used to await Get-ScheduledTask, which cost ~7 s on every open.
  assert.match(source, /const task = peekTask\(\)/);
  assert.match(source, /if \(!task\) queryTask\(\)\.catch/);
  // Secret presence checks are synchronous now; an async helper would put a
  // Promise into the JSON reply and hide every "saved" badge.
  assert.match(source, /secrets: secretStatus\(config\)/);
  assert.doesNotMatch(source, /async function secretStatus/);
});
