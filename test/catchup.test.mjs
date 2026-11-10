import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createStore } from '../lib/engine/store.js';
import { runBriefing } from '../lib/engine/runner.js';

test('a missed scheduled run waits before the next window, then publishes that day', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-catchup-'));
  try {
    const store = createStore(dir);
    store.saveConfig({
      version: 2,
      timezone: 'Asia/Shanghai',
      sources: [{ id: 'off', type: 'http', label: 'off', section: 'aiNews', url: 'http://127.0.0.1:9/', enabled: false }],
      ai: { polish: 'off' },
      delivery: { popup: { enabled: false }, email: { enabled: false }, webhook: { enabled: false } },
      schedule: { time: '08:00', prepareLeadMin: 10, enabled: true },
    });

    // 00:30 after a missed 08:00: yesterday's issue is stale; wait for the
    // upcoming prepare/publish window instead of generating hours early.
    const early = await runBriefing({ store: dir, now: '2026-11-11T00:30:00+08:00', trigger: 'schedule' });
    assert.equal(early.phase, 'idle');
    assert.equal(early.skipped, true);
    assert.equal(early.reason, 'stale-publish');

    const prep = await runBriefing({ store: dir, now: '2026-11-11T07:50:00+08:00', trigger: 'schedule' });
    assert.equal(prep.phase, 'prepare');
    assert.equal(prep.published, false);
    assert.equal(prep.dateKey, '2026-11-11');

    const publish = await runBriefing({ store: dir, now: '2026-11-11T08:00:05+08:00', trigger: 'schedule' });
    assert.equal(publish.phase, 'publish');
    assert.equal(publish.reused, true);
    assert.equal(store.loadState().lastDeliveredDate, '2026-11-11');

    // A same-day missed publish is caught up when the machine comes back.
    const late = await runBriefing({ store: dir, now: '2026-11-12T15:00:00+08:00', trigger: 'schedule' });
    assert.equal(late.phase, 'publish');
    assert.equal(late.dateKey, '2026-11-12');
    assert.equal(late.reused, false);
    assert.equal(store.loadState().lastDeliveredDate, '2026-11-12');

    const again = await runBriefing({ store: dir, now: '2026-11-12T18:00:00+08:00', trigger: 'schedule' });
    assert.equal(again.skipped, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
