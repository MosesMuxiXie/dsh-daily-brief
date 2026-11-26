import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyFromEnv, sanitizeProxyEnv } from '../lib/engine/route.js';

test('proxyFromEnv accepts the host:port form and the URL form', () => {
  assert.deepEqual(proxyFromEnv({ HTTPS_PROXY: '127.0.0.1:7897' }), {
    url: 'http://127.0.0.1:7897',
    host: '127.0.0.1',
    port: 7897,
  });
  assert.deepEqual(proxyFromEnv({ HTTPS_PROXY: 'http://127.0.0.1:7897' }), {
    url: 'http://127.0.0.1:7897',
    host: '127.0.0.1',
    port: 7897,
  });
  assert.equal(proxyFromEnv({}), null);
});

test('sanitizeProxyEnv removes a dead proxy and keeps a live one', async () => {
  const env = {
    HTTPS_PROXY: 'http://127.0.0.1:7897',
    HTTP_PROXY: 'http://127.0.0.1:7897',
    NODE_USE_ENV_PROXY: '1',
    PATH: 'C:\\Windows',
  };
  const dead = await sanitizeProxyEnv(env, { probe: async () => false });
  assert.equal(dead.HTTPS_PROXY, undefined);
  assert.equal(dead.HTTP_PROXY, undefined);
  assert.equal(dead.NODE_USE_ENV_PROXY, undefined);
  assert.equal(dead.PATH, 'C:\\Windows');

  const live = await sanitizeProxyEnv(env, { probe: async () => true });
  assert.equal(live.HTTPS_PROXY, 'http://127.0.0.1:7897');
  assert.equal(live.NODE_USE_ENV_PROXY, '1');
});
