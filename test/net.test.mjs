import test from 'node:test';
import assert from 'node:assert/strict';
import { probeNetwork, waitForNetwork } from '../lib/engine/net.js';

const DEAD_HOSTS = [
  'no-such-host-1.invalid',
  'no-such-host-2.invalid',
  'no-such-host-3.invalid',
  'no-such-host-4.invalid',
];

test('probeNetwork reports failure when no probe host resolves', async () => {
  const probe = await probeNetwork({ hosts: DEAD_HOSTS, timeoutMs: 1500 });
  assert.equal(probe.ok, false);
  assert.equal(probe.resolved, 0);
  assert.equal(probe.total, 4);
  assert.equal(probe.tcp, null);
});

test('waitForNetwork gives up after the budget instead of hanging', async () => {
  const logs = [];
  const started = Date.now();
  const result = await waitForNetwork({
    hosts: DEAD_HOSTS,
    timeoutMs: 1200,
    intervalMs: 300,
    log: (line) => logs.push(line),
  });
  const waited = Date.now() - started;
  assert.equal(result.ok, false);
  assert.ok(result.attempts >= 2, 'keeps probing while the budget lasts');
  assert.ok(waited >= 1100 && waited < 6000, `budget honoured, waited ${waited}ms`);
  assert.match(logs.at(-1), /继续尝试抓取/);
});

test('waitForNetwork returns at once on a usable network', async () => {
  const probe = await probeNetwork();
  if (!probe.ok) {
    // 离线环境（CI / 断网调试）没有可断言的“网络可用”前提，跳过而不是误报。
    return;
  }
  const started = Date.now();
  const result = await waitForNetwork({ timeoutMs: 5000 });
  assert.equal(result.ok, true);
  assert.equal(result.attempts, 1);
  assert.ok(Date.now() - started < 5000);
});
