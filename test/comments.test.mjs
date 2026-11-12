/**
 * Comment reading: the most discussed video of the day becomes a card of its
 * own, and every count label YouTube ships (712 / 1,234 / 2.5K / 1.2万 / 12M)
 * has to end up as the same number so ranking works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseCountText } from '../lib/engine/collect/youtube-comments.js';
import { buildBriefing } from '../lib/engine/render/model.js';
import { renderBriefingHtml } from '../lib/engine/render/html.js';
import { renderBriefingText } from '../lib/engine/render/email.js';
import { mergeConfig } from '../lib/engine/config.js';

test('comment counts parse from every label YouTube uses', () => {
  assert.equal(parseCountText('712'), 712);
  assert.equal(parseCountText('1,234'), 1234);
  assert.equal(parseCountText('2.5K'), 2500);
  assert.equal(parseCountText('1.2万'), 12000);
  assert.equal(parseCountText('12M'), 12000000);
  assert.equal(parseCountText('0'), 0);
  // A label with no digits means "unknown", not "no comments".
  assert.equal(parseCountText(''), null);
  assert.equal(parseCountText('评论'), null);
});

test('the most commented video becomes a featured card in the brief', () => {
  const config = mergeConfig({
    sources: [
      {
        id: 'yt',
        type: 'youtube',
        label: 'YT',
        section: 'gameNews',
        url: 'https://www.youtube.com/@demo',
        options: {},
      },
    ],
  });
  const now = new Date();
  const results = [
    {
      source: config.sources[0],
      result: {
        sourceId: 'yt',
        status: 'ok',
        items: [
          {
            id: 'a',
            title: 'quiet video',
            url: 'https://youtu.be/a',
            date: now.toISOString(),
            commentCount: 3,
          },
        ],
        featured: {
          id: 'b',
          title: 'loud video',
          url: 'https://youtu.be/b',
          date: now.toISOString(),
          commentCount: 46,
          section: 'gameNews',
          comments: [{ author: '@fan', text: 'the intro is lazy', likes: 22 }],
        },
      },
    },
  ];
  const briefing = buildBriefing({ config, results, now, dateKey: '2026-11-12' });
  assert.equal(briefing.featured.title, 'loud video');
  assert.equal(briefing.featured.commentCount, 46);
  assert.equal(briefing.featured.sectionZh, '游戏');

  const html = renderBriefingHtml(briefing);
  assert.match(html, /今日热议/);
  assert.match(html, /46 条评论/);
  assert.match(html, /the intro is lazy/);

  const text = renderBriefingText(briefing);
  assert.match(text, /【今日热议】loud video（46 条评论）/);
});

test('a brief without a commented video renders no featured card', () => {
  const config = mergeConfig({ sources: [] });
  const briefing = buildBriefing({ config, results: [], now: new Date(), dateKey: '2026-11-12' });
  assert.equal(briefing.featured, null);
  assert.doesNotMatch(renderBriefingHtml(briefing), /今日热议/);
});
