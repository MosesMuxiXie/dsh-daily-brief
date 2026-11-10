import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { registerRoutes } from '../lib/host/routes.js';

const PREFIX = '/api/daily-brief';

function makeService() {
  const calls = [];
  return {
    calls,
    getState: async () => ({ ok: true, state: 'ready' }),
    getBriefing: async (id) =>
      id === 'missing' ? { ok: false, error: '未找到' } : { ok: true, id, html: '<p>brief</p>' },
    saveConfig: async (patch) => {
      calls.push(['saveConfig', patch]);
      return { ok: true, patch };
    },
  };
}

function makeCtx(connection) {
  let handler;
  const ctx = {
    connection,
    get(name) {
      return name === 'connection' ? connection : undefined;
    },
    webServer: {
      register(route) {
        handler = route.handler;
        return () => {};
      },
    },
    effect() {},
  };
  return { ctx, handler: () => handler };
}

function makeRes() {
  return {
    statusCode: 0,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    end(chunk) {
      this.body = chunk;
      this.ended = true;
    },
  };
}

async function call(handler, { method = 'GET', path = '/health', headers = {}, address = '127.0.0.1', body } = {}) {
  const req = new PassThrough();
  req.method = method;
  req.url = `${PREFIX}${path}`;
  req.headers = headers;
  req.socket = { remoteAddress: address };
  req.end(body);
  const res = makeRes();
  await handler(req, res);
  const text = typeof res.body === 'string' ? res.body : '';
  const json = text && String(res.headers['content-type'] || '').includes('application/json') ? JSON.parse(text) : undefined;
  return { status: res.statusCode, headers: res.headers, text, json };
}

function withConnection(implementation) {
  const service = makeService();
  const connection = implementation === undefined ? undefined : { requestRejection: implementation };
  const { ctx, handler } = makeCtx(connection);
  registerRoutes(ctx, service);
  return { service, handler: handler() };
}

test('legacy host rejects a missing or wrong client header', async () => {
  const { handler } = withConnection(undefined);
  const missing = await call(handler);
  assert.equal(missing.status, 403);
  assert.match(missing.json.error, /客户端标识/);

  const wrong = await call(handler, { headers: { 'x-daily-brief-client': '0' } });
  assert.equal(wrong.status, 403);
});

test('legacy host admits a loopback request carrying the client header', async () => {
  const { handler } = withConnection(undefined);
  const res = await call(handler, { headers: { 'x-daily-brief-client': '1' } });
  assert.equal(res.status, 200);
  assert.equal(res.json.ok, true);
});

test('legacy host rejects a non-loopback request even with the client header', async () => {
  const { handler } = withConnection(undefined);
  const res = await call(handler, { headers: { 'x-daily-brief-client': '1' }, address: '192.168.1.9' });
  assert.equal(res.status, 403);
  assert.match(res.json.error, /仅限本机/);
});

test('a rejected Connection admission answers 401 without touching the service', async () => {
  const { service, handler } = withConnection(() => 401);
  const res = await call(handler, { path: '/state' });
  assert.equal(res.status, 401);
  assert.match(res.json.error, /认证/);
  assert.deepEqual(service.calls, []);
});

test('an admitted Connection request needs no client header', async () => {
  const seen = [];
  const { handler } = withConnection((req) => {
    seen.push(req.url);
    return undefined;
  });
  const res = await call(handler, { path: '/state' });
  assert.equal(res.status, 200);
  assert.equal(res.json.state, 'ready');
  assert.deepEqual(seen, [`${PREFIX}/state`]);
});

test('an admitted POST keeps parsing its JSON body', async () => {
  const { service, handler } = withConnection(() => undefined);
  const res = await call(handler, {
    method: 'POST',
    path: '/config',
    body: JSON.stringify({ patch: { retentionDays: 7 } }),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(service.calls, [['saveConfig', { retentionDays: 7 }]]);
});

test('a rejected POST never reads or applies its body', async () => {
  const { service, handler } = withConnection(() => 401);
  const res = await call(handler, {
    method: 'POST',
    path: '/config',
    body: JSON.stringify({ patch: { retentionDays: 7 } }),
  });
  assert.equal(res.status, 401);
  assert.deepEqual(service.calls, []);
});

test('the artifact page follows the same admission policy', async () => {
  const rejected = withConnection(() => 401);
  const denied = await call(rejected.handler, { path: '/artifact' });
  assert.equal(denied.status, 401);

  const admitted = withConnection(() => undefined);
  const page = await call(admitted.handler, { path: '/artifact' });
  assert.equal(page.status, 200);
  assert.match(String(page.headers['content-type']), /text\/html/);
  assert.match(page.text, /<p>brief<\/p>/);

  const missing = await call(admitted.handler, { path: '/artifact?id=missing' });
  assert.equal(missing.status, 404);
});

test('a Connection service without requestRejection falls back to the strict local gate', async () => {
  const service = makeService();
  const { ctx, handler } = makeCtx({});
  registerRoutes(ctx, service);

  const denied = await call(handler());
  assert.equal(denied.status, 403);

  const admitted = await call(handler(), { headers: { 'x-daily-brief-client': '1' } });
  assert.equal(admitted.status, 200);
});

test('a throwing admission check fails closed with 503', async () => {
  const { handler } = withConnection(() => {
    throw new Error('connection is down');
  });
  const res = await call(handler, { path: '/state' });
  assert.equal(res.status, 503);
  assert.match(res.json.error, /校验/);
});
