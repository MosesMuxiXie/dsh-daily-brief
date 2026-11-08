import test from 'node:test';
import assert from 'node:assert/strict';

import { parseFeedXml } from '../lib/engine/collect/feed.js';
import { guessJsonMapping, getByPath } from '../lib/engine/collect/json.js';
import { applyAiPolish, buildBriefing } from '../lib/engine/render/model.js';
import { renderBriefingHtml } from '../lib/engine/render/html.js';
import { defaultConfig, mergeConfig, personaFor } from '../lib/engine/config.js';
import { splitInputs, guessMailSettings, probeMany } from '../lib/engine/import/detect.js';
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
      aiNews: ['OpenAI 更新了智能体记忆机制，重点放在长期上下文', 'Anthropic 让 Claude 参与 MMORPG 实验'],
      gameNews: ['坦克世界闪击战上线花桥行动', 'K-70 活动持续到月底'],
    },
  });
  const aiAfter = polished.sections.find((section) => section.id === 'aiNews');
  assert.deepEqual(aiAfter.points, [
    'OpenAI 更新了智能体记忆机制，重点放在长期上下文',
    'Anthropic 让 Claude 参与 MMORPG 实验',
  ]);
  const html = renderBriefingHtml(polished);
  assert.match(html, /<ul class="points">/);
  assert.equal((html.match(/<a /g) || []).length, 0);
});

test('import helpers split lines and suggest IMAP settings', () => {
  const lines = splitInputs('https://example.com/feed\n\nyou@gmail.com\nhttps://example.com/feed');
  assert.deepEqual(lines, ['https://example.com/feed', 'you@gmail.com']);
  const mail = guessMailSettings('you@gmail.com');
  assert.equal(mail.host, 'imap.gmail.com');
  assert.equal(mail.port, 993);
});

test('briefing keeps at most five news rows with the 3/2 AI-game split', () => {
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
  assert.equal(briefing.stats.items, 5);
  assert.equal(briefing.sections.find((section) => section.id === 'aiNews').items.length, 3);
  assert.equal(briefing.sections.find((section) => section.id === 'gameNews').items.length, 2);
  assert.equal(briefing.sections.find((section) => section.id === 'server').server.online, true);
  assert.match(briefing.headline, /AI|游戏/);
});

test('v1 config migrates old broad presets into the focused v2 sources', () => {
  const migrated = mergeConfig({
    version: 1,
    sources: [
      { id: 'preset-ai-hn', type: 'rss', section: 'aiNews', label: 'Hacker News', enabled: true, url: 'https://hnrss.org/frontpage' },
      { id: 'custom-mine', type: 'rss', section: 'custom', label: '我的订阅', enabled: true, url: 'https://example.com/feed' },
    ],
  });
  assert.equal(migrated.version, 2);
  assert.equal(migrated.sources.some((source) => source.id === 'preset-ai-hn'), false);
  assert.equal(migrated.sources.some((source) => source.type === 'x'), true);
  assert.equal(migrated.sources.some((source) => source.type === 'steam'), false);
  assert.equal(migrated.sources.some((source) => source.type === 'minecraft'), false);
  assert.equal(migrated.sources.some((source) => source.id === 'custom-mine'), true);
  assert.equal(migrated.delivery.popup.enabled, true);
  assert.equal(migrated.delivery.toast, undefined);
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
  assert.match(briefing.headline, /AI|游戏|其他/);
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

