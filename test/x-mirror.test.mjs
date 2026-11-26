import test from 'node:test';
import assert from 'node:assert/strict';
import { collectX } from '../lib/engine/collect/x.js';

const X_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Twitter @OpenAI</title>
  <item>
    <title>A new model is available today.</title>
    <description>A new model is available today.</description>
    <link>https://x.com/OpenAI/status/2125635627341561995</link>
    <pubDate>Wed, 25 Nov 2026 17:00:00 GMT</pubDate>
  </item>
</channel>
</rss>`;

const src = {
  id: 'x-openai',
  type: 'x',
  section: 'aiNews',
  label: 'OpenAI',
  enabled: true,
  url: 'https://x.com/OpenAI',
  options: { handle: 'OpenAI', limit: 3, sinceHours: 40 },
};

test('X uses the RSSHub mirror first when no proxy is available', async () => {
  const paths = [];
  const result = await collectX(src, {
    storeDir: '',
    proxyAvailable: false,
    mirrorText: async (path) => {
      paths.push(path);
      return { ok: true, status: 200, text: X_FEED, bytes: 120, mirror: 'https://mirror.test' };
    },
  });
  assert.deepEqual(paths, ['/twitter/user/OpenAI']);
  assert.equal(result.status, 'ok');
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].title, 'A new model is available today.');
  assert.match(result.items[0].url, /2125635627341561995$/);
});

test('X does not reach for the mirror when a working proxy is configured', async () => {
  let mirrorCalls = 0;
  const result = await collectX(src, {
    storeDir: '',
    proxyAvailable: true,
    mirrorText: async () => {
      mirrorCalls += 1;
      return { ok: true, status: 200, text: X_FEED, bytes: 120, mirror: 'https://mirror.test' };
    },
    graphql: async () => ({
      tweets: [
        {
          id_str: '1',
          full_text: 'From the official endpoint',
          created_at: new Date().toISOString(),
          screen_name: 'OpenAI',
          has_media: false,
        },
      ],
    }),
  });
  assert.equal(mirrorCalls, 0);
  assert.equal(result.items[0].title, 'From the official endpoint');
});
