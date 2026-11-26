import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectSource } from '../lib/engine/collect/index.js';

function tempStore() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'db-stale-'));
}

function source(type = 'rss') {
  return {
    id: `test-${type}`,
    type,
    section: 'aiNews',
    label: '测试来源',
    enabled: true,
    url: 'https://example.com/feed',
    options: { limit: 5, sinceHours: 24 },
  };
}

test('a timed-out source falls back to its last good items', async () => {
  const storeDir = tempStore();
  try {
    const first = await collectSource(source(), {
      storeDir,
      collectors: {
        rss: async () => ({
          items: [
            {
              title: '昨天的新闻',
              url: 'https://example.com/1',
              date: new Date().toISOString(),
            },
          ],
        }),
      },
    });
    assert.equal(first.status, 'ok');
    assert.equal(first.items.length, 1);

    const second = await collectSource(source(), {
      storeDir,
      collectors: {
        rss: async () => {
          throw new Error('获取超时（12 秒）');
        },
      },
    });
    assert.equal(second.status, 'degraded');
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].title, '昨天的新闻');
    assert.match(second.note, /获取超时（12 秒）/);
    assert.match(second.note, /显示上次结果/);
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});

test('an http monitor never serves stale items as if the server were up', async () => {
  const storeDir = tempStore();
  try {
    await collectSource(source('http'), {
      storeDir,
      collectors: {
        http: async () => ({
          status: 'ok',
          items: [{ title: '监控 运行正常', url: 'https://example.com/status', date: new Date().toISOString() }],
        }),
      },
    });

    const failed = await collectSource(source('http'), {
      storeDir,
      collectors: {
        http: async () => {
          throw new Error('获取超时（5 秒）');
        },
      },
    });
    assert.equal(failed.status, 'error');
    assert.equal(failed.items.length, 0);
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});
