import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { fetchDirectText } from '../lib/engine/http-direct.js';

async function withServer(handler, fn) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('direct fetch ignores a dead proxy in the environment', async () => {
  const saved = {
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    HTTP_PROXY: process.env.HTTP_PROXY,
    NODE_USE_ENV_PROXY: process.env.NODE_USE_ENV_PROXY,
  };
  process.env.HTTPS_PROXY = 'http://127.0.0.1:1';
  process.env.HTTP_PROXY = 'http://127.0.0.1:1';
  process.env.NODE_USE_ENV_PROXY = '1';
  try {
    await withServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('镜像直连成功');
    }, async (base) => {
      const response = await fetchDirectText(`${base}/feed`, { timeoutMs: 2000 });
      assert.equal(response.status, 200);
      assert.equal(response.text, '镜像直连成功');
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('direct fetch decompresses a gzip response', async () => {
  await withServer((req, res) => {
    const body = zlib.gzipSync('压缩后的订阅内容');
    res.writeHead(200, {
      'content-type': 'application/xml; charset=utf-8',
      'content-encoding': 'gzip',
    });
    res.end(body);
  }, async (base) => {
    const response = await fetchDirectText(`${base}/feed`);
    assert.equal(response.text, '压缩后的订阅内容');
  });
});

test('direct fetch reports its own timeout', async () => {
  await withServer((req, res) => {
    // Never answer: the client must give up on its own budget.
    res.writeHead(200, { 'content-type': 'text/plain' });
  }, async (base) => {
    await assert.rejects(fetchDirectText(`${base}/slow`, { timeoutMs: 150 }), /请求超时/);
  });
});

test('direct fetch follows a redirect', async () => {
  await withServer((req, res) => {
    if (req.url === '/old') {
      res.writeHead(302, { location: '/new' });
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('new location');
  }, async (base) => {
    const response = await fetchDirectText(`${base}/old`);
    assert.equal(response.text, 'new location');
    assert.match(response.finalUrl, /\/new$/);
  });
});
