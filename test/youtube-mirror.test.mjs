import test from 'node:test';
import assert from 'node:assert/strict';
import { collectChannelMirror } from '../lib/engine/collect/youtube.js';

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

test('the YouTube mirror path reads a channel by handle without a channel id', async () => {
  const paths = [];
  const result = await collectChannelMirror(
    {
      id: 'yt-droodles',
      type: 'youtube',
      section: 'gameNews',
      label: 'Droodles Blitz',
      url: 'https://www.youtube.com/@DroodlesBlitz',
      options: { handle: 'DroodlesBlitz', limit: 8, sinceHours: 72 },
    },
    { handle: 'DroodlesBlitz' },
    {
      mirrorText: async (path) => {
        paths.push(path);
        return { ok: true, status: 200, text: YOUTUBE_FEED, bytes: 200, mirror: 'https://mirror.test' };
      },
    },
  );
  assert.deepEqual(paths, ['/youtube/user/@DroodlesBlitz']);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].badge, 'YouTube');
  assert.match(result.note, /镜像/);
});
