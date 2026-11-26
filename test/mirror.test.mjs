import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mirrorText,
  resetMirrorHealth,
  tweetsFromMirrorFeed,
  youtubeItemsFromMirrorFeed,
} from '../lib/engine/collect/mirror.js';

const X_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel>
  <title>Twitter @OpenAI</title>
  <item>
    <title>For ordinary days that feel like a movie. Make a Day Do Anything with ChatGPT.</title>
    <description>For ordinary days that feel like a movie. Make a Day Do Anything with ChatGPT.</description>
    <link>https://x.com/OpenAI/status/2125635627341561995</link>
    <pubDate>Wed, 25 Nov 2026 17:00:00 GMT</pubDate>
    <dc:creator>@OpenAI</dc:creator>
  </item>
  <item>
    <title>We’re sharing a new preprint showing wet lab validation of intrinsic protein design capabilities of the GPT-6 family of models. Our models can design...</title>
    <description>We’re sharing a new preprint showing wet lab validation of intrinsic protein design capabilities of the GPT-6 family of models. Our models can design new protein shapes and sequences using…</description>
    <link>https://x.com/OpenAI/status/2125334383490105601</link>
    <pubDate>Tue, 24 Nov 2026 21:02:58 GMT</pubDate>
  </item>
</channel>
</rss>`;

const YOUTUBE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Droodles Blitz - YouTube</title>
  <item>
    <title>The TYPE 5 ZETSU JUST BECAME INSANE</title>
    <link>https://www.youtube.com/watch?v=mz3E7Hv0RZc</link>
    <pubDate>Wed, 25 Nov 2026 17:16:48 GMT</pubDate>
  </item>
</channel>
</rss>`;

test('mirror feed becomes tweets with ids, text and dates', () => {
  const tweets = tweetsFromMirrorFeed(X_FEED, 'OpenAI');
  assert.equal(tweets.length, 2);
  assert.equal(tweets[0].id_str, '2125635627341561995');
  assert.equal(tweets[0].screen_name, 'OpenAI');
  assert.match(tweets[0].created_at, /^2026-11-25/);
  assert.match(tweets[0].full_text, /Day Do Anything/);
});

test('mirror feed prefers the longer description when the title is truncated', () => {
  const tweets = tweetsFromMirrorFeed(X_FEED, 'OpenAI');
  const second = tweets.find((tweet) => tweet.id_str === '2125334383490105601');
  assert.ok(second);
  assert.match(second.full_text, /new protein shapes and sequences/);
});

test('youtube mirror feed keeps video metadata', () => {
  const items = youtubeItemsFromMirrorFeed(YOUTUBE_FEED, 'DroodlesBlitz');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'The TYPE 5 ZETSU JUST BECAME INSANE');
  assert.equal(items[0].badge, 'YouTube');
  assert.equal(items[0].meta, 'Droodles Blitz');
});

test('mirrorText falls through to the next mirror after a 429', async () => {
  resetMirrorHealth();
  const calls = [];
  const result = await mirrorText('/twitter/user/OpenAI', {
    mirrors: ['https://a.test', 'https://b.test'],
    fetchDirect: async (url) => {
      calls.push(url);
      if (url.includes('a.test')) return { ok: false, status: 429, text: '', bytes: 0 };
      return { ok: true, status: 200, text: '<rss>ok</rss>', bytes: 10 };
    },
  });
  assert.equal(result.mirror, 'https://b.test');
  assert.equal(result.text, '<rss>ok</rss>');
  assert.deepEqual(calls, ['https://a.test/twitter/user/OpenAI', 'https://b.test/twitter/user/OpenAI']);
});

test('mirrorText remembers a rate-limited mirror for later calls', async () => {
  resetMirrorHealth();
  const calls = [];
  const fetchDirect = async (url) => {
    calls.push(url);
    if (url.includes('a.test')) return { ok: false, status: 429, text: '', bytes: 0 };
    return { ok: true, status: 200, text: '<rss>ok</rss>', bytes: 10 };
  };
  const options = { mirrors: ['https://a.test', 'https://b.test'], fetchDirect };
  await mirrorText('/one', options);
  await mirrorText('/two', options);
  assert.equal(calls.filter((url) => url.includes('a.test')).length, 1);
  assert.equal(calls.filter((url) => url.includes('b.test')).length, 2);
});

test('mirrorText stops after its total budget when every mirror hangs', async () => {
  resetMirrorHealth();
  const started = Date.now();
  await assert.rejects(
    mirrorText('/twitter/user/OpenAI', {
      mirrors: ['https://a.test', 'https://b.test', 'https://c.test'],
      timeoutMs: 30,
      totalMs: 70,
      fetchDirect: () => new Promise(() => {}),
    }),
    /镜像不可用/,
  );
  assert.ok(Date.now() - started < 1000, 'a hanging mirror must not hold the collector');
});
