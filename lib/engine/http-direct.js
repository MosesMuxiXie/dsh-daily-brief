/**
 * Direct HTTP text fetch that never reads the ambient proxy settings.
 *
 * Node's global fetch honours HTTPS_PROXY / NODE_USE_ENV_PROXY. That is the
 * right thing for the DSH host process, but it is exactly wrong for the
 * scheduled briefing: the task may run while Clash Verge is closed, and a
 * dangling 127.0.0.1:7897 turns every request into a black hole. Mirror
 * requests use this module instead, so they keep working with or without a
 * local proxy.
 */
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 3;
const USER_AGENT = 'DSH-DailyBrief/1.0 (+mirror)';

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function decodeBody(buffer, encoding) {
  const value = String(encoding || '')
    .trim()
    .toLowerCase();
  if (value === '' || value === 'identity') return buffer;
  if (value === 'gzip' || value === 'x-gzip') return zlib.gunzipSync(buffer);
  if (value === 'deflate') {
    try {
      return zlib.inflateSync(buffer);
    } catch {
      return zlib.inflateRawSync(buffer);
    }
  }
  if (value === 'br') return zlib.brotliDecompressSync(buffer);
  return buffer;
}

function requestOnce(target, { timeoutMs, maxBytes, headers }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let request;
    let timer;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    // request.setTimeout only starts once the socket is connected; DNS and the
    // TCP/TLS handshake can hang forever when a host is blackholed. Keep an
    // independent wall-clock deadline so a mirror attempt always settles.
    timer = setTimeout(() => {
      done(new Error(`请求超时（${Math.max(1, Math.round(timeoutMs / 1000))} 秒）`));
      request?.destroy();
    }, timeoutMs);

    let url;
    try {
      url = new URL(target);
    } catch {
      done(new Error('链接格式无效'));
      return;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      done(new Error('只支持 http/https 链接'));
      return;
    }

    const client = url.protocol === 'https:' ? https : http;
    request = client.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        timeout: timeoutMs,
        headers,
      },
      (response) => {
        const status = response.statusCode || 0;
        const location = response.headers.location;
        if (status >= 300 && status < 400 && location) {
          response.resume();
          done(null, { ok: false, status, location, text: '', bytes: 0, finalUrl: target, headers: response.headers });
          return;
        }
        const chunks = [];
        let total = 0;
        response.on('data', (chunk) => {
          total += chunk.length;
          if (total > maxBytes) {
            done(new Error(`内容超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          if (settled) return;
          let body;
          try {
            body = decodeBody(Buffer.concat(chunks), response.headers['content-encoding']);
          } catch (error) {
            done(new Error(`解压响应失败：${error.message}`));
            return;
          }
          done(null, {
            ok: status >= 200 && status < 300,
            status,
            text: body.toString('utf8'),
            bytes: body.length,
            finalUrl: target,
            headers: response.headers,
          });
        });
        response.on('error', (error) => done(new Error(`读取响应失败：${error.message}`)));
      },
    );

    request.setTimeout(timeoutMs, () => {
      done(new Error(`请求超时（${Math.max(1, Math.round(timeoutMs / 1000))} 秒）`));
      request.destroy();
    });
    request.on('error', (error) => done(new Error(`直连失败：${error.message}`)));
    request.end();
  });
}

/**
 * Fetch a URL as text with node:http/node:https only.
 * @returns {Promise<{ok:boolean,status:number,text:string,bytes:number,finalUrl:string,headers:object}>}
 */
export async function fetchDirectText(rawUrl, options = {}) {
  const timeoutMs = positive(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const maxBytes = positive(options.maxBytes, DEFAULT_MAX_BYTES);
  const redirects = Number.isInteger(options.redirects) && options.redirects >= 0 ? options.redirects : MAX_REDIRECTS;
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
    'accept-encoding': 'gzip, deflate, br',
    ...options.headers,
  };

  let current = String(rawUrl ?? '').trim();
  for (let hop = 0; ; hop += 1) {
    const response = await requestOnce(current, { timeoutMs, maxBytes, headers });
    if (response.location && response.status >= 300 && response.status < 400) {
      if (hop >= redirects) throw new Error('重定向次数过多');
      current = new URL(response.location, current).href;
      continue;
    }
    return response;
  }
}
