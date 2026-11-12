/**
 * Bilibili comment pass: counts come straight from the list payload when the
 * API already sent them, a blocked client degrades to "no count" instead of
 * losing the video, and the most-discussed upload becomes the featured card.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  commentCountFromVideo,
  enrichBilibiliComments,
  fetchVideoComments,
  normalizeReply,
  parseReplyCount,
  plainCommentText,
  readReplyPage,
} from '../lib/engine/collect/bilibili-comments.js';

function reply(rpid, name, message, like, rcount = 0, ctime = 1762900000) {
  return { rpid, member: { uname: name }, content: { message }, like, rcount, ctime };
}

test('a list payload already carries the reply count', () => {
  assert.equal(commentCountFromVideo({ stat: { reply: 52688 } }), 52688);
  assert.equal(commentCountFromVideo({ comment: 2474 }), 2474);
  // A zero is "not reported yet", not a ranking of zero.
  assert.equal(commentCountFromVideo({ stat: { reply: 0 } }), 0);
  assert.equal(commentCountFromVideo({}), 0);
  assert.equal(commentCountFromVideo(null), 0);
});

test('pinned and hot replies merge, dedupe and sort by likes', () => {
  const rows = readReplyPage({
    top_replies: [reply('1', 'up', '置顶：看简介 <b>', 9999)],
    replies: [
      reply('2', 'fan-a', '好看', 12),
      reply('1', 'up', '置顶：看简介 <b>', 9999),
      reply('3', 'fan-b', '', 50),
      reply('4', 'fan-c', 'a'.repeat(400), 30, 7),
    ],
  });
  assert.deepEqual(
    rows.map((row) => row.id),
    ['1', '4', '2'],
  );
  assert.equal(rows[0].text, '置顶：看简介');
  assert.equal(rows[1].text.length, 220);
  assert.equal(rows[1].replies, 7);
  assert.equal(rows[1].published, new Date(1762900000 * 1000).toISOString());
});

test('emote placeholders are stripped so the card shows text only', () => {
  // 弹幕表情在正文里形如 [doge] / [间奏时光表情包_狂点]，渲染出来像乱码。
  assert.equal(
    plainCommentText('装甲就比不过那俩[间奏时光表情包_狂点]同级正面'),
    '装甲就比不过那俩 同级正面'.replace(/\s+/g, ' '),
  );
  assert.equal(plainCommentText('[doge]好看[doge]'), '好看');
  // 整条只有表情时退回原文，别把评论弄没。
  assert.equal(plainCommentText('[doge]'), '[doge]');
  assert.equal(normalizeReply(reply('9', 'fan', '一句[doge]话', 1)).text, '一句 话');
  // 方括号里带空格的是普通文字，不该被吃掉。
  assert.equal(plainCommentText('数值[按 1.35 算]偏高'), '数值[按 1.35 算]偏高');
});

test('a missing count is unknown, not zero', () => {
  assert.equal(parseReplyCount({ count: 0 }), 0);
  assert.equal(parseReplyCount({ count: 52 }), 52);
  assert.equal(parseReplyCount({}), null);
  assert.equal(parseReplyCount({ count: 'x' }), null);
});

test('the most discussed upload is featured and keeps its hot replies', async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bili-'));
  const calls = [];
  const getJson = async (url) => {
    calls.push(url);
    if (url.includes('/reply/count')) return { data: { count: 42 }, bytes: 40, elapsedMs: 10 };
    return {
      data: {
        top_replies: [reply('9', 'pinned', '置顶评论', 500)],
        replies: [reply('10', 'fan', '这期真好', 88), reply('11', 'fan2', '笑死', 120)],
      },
      bytes: 900,
      elapsedMs: 20,
    };
  };
  const items = [
    { id: 'bilibili-a', aid: 111, title: 'quiet', url: 'https://www.bilibili.com/video/BV1a', commentCount: 5 },
    { id: 'bilibili-b', aid: 222, title: 'loud', url: 'https://www.bilibili.com/video/BV1b' },
  ];
  const out = await enrichBilibiliComments(items, { commentsPerVideo: 2 }, { storeDir }, getJson);

  assert.equal(out.featured.title, 'loud');
  assert.equal(out.featured.commentCount, 42);
  assert.equal(out.featured.comments.length, 2);
  assert.equal(out.featured.comments[0].author, 'pinned');
  assert.match(out.note, /评论最多：loud（42 条）/);
  // Only the video without a payload count asks for one.
  assert.equal(calls.filter((url) => url.includes('/reply/count')).length, 1);
  assert.ok(out.bytes > 0);
});

test('a blocked count response leaves every title in place', async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bili-'));
  const getJson = async () => {
    throw new Error('B 站接口触发风控（-352/-412），本次先跳过');
  };
  const items = [{ id: 'bilibili-c', aid: 333, title: 'kept', url: 'https://www.bilibili.com/video/BV1c' }];
  const out = await enrichBilibiliComments(items, {}, { storeDir }, getJson);
  assert.equal(out.items.length, 1);
  assert.equal(out.items[0].title, 'kept');
  assert.equal(out.featured, null);
  assert.match(out.note, /评论数暂时读不到/);
});

test('comments can be switched off per source', async () => {
  let asked = 0;
  const getJson = async () => {
    asked += 1;
    return { data: {}, bytes: 0, elapsedMs: 0 };
  };
  const out = await enrichBilibiliComments(
    [{ id: 'x', aid: 1, title: 't', url: 'u' }],
    { comments: false },
    { storeDir: '' },
    getJson,
  );
  assert.equal(asked, 0);
  assert.equal(out.featured, null);
});

test('a second lookup is served from the comment cache', async () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bili-'));
  let calls = 0;
  const getJson = async (url) => {
    calls += 1;
    if (url.includes('/reply/count')) return { data: { count: 3 }, bytes: 1, elapsedMs: 1 };
    return { data: { replies: [reply('1', 'a', '嗨', 2)] }, bytes: 1, elapsedMs: 1 };
  };
  const first = await fetchVideoComments(444, { getJson, storeDir });
  const second = await fetchVideoComments(444, { getJson, storeDir });
  assert.equal(first.commentCount, 3);
  assert.equal(second.commentCount, 3);
  assert.equal(second.comments[0].text, '嗨');
  assert.equal(calls, 2);
  assert.equal(second.cached, true);
});
