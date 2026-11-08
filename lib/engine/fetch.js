/**
 * One HTTP client for every source.
 *
 * Guarantees used by both the import preview and the scheduled run:
 * - http/https only, no credentials in the URL;
 * - DNS resolution and every redirect hop checked against LAN/metadata rules;
 * - byte, time and redirect budgets;
 * - charset-aware decoding;
 * - TLS certificate facts for the server-health source.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) DSH-DailyBrief/1.0';

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

function ipv4Parts(ip) {
  return ip.split('.').map((part) => Number(part));
}

function isIpv4Blocked(ip, allowPrivate) {
  const parts = ipv4Parts(ip);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  // Link-local, metadata, unspecified, multicast, reserved.
  if (a === 169 && b === 254) return true;
  if (a === 0 || a === 127) return !allowPrivate ? a === 127 : false;
  if (ip === '100.100.100.200') return true;
  if (a >= 224) return true;
  const isPrivate = a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  if (isPrivate) return !allowPrivate;
  return false;
}

function isIpv6Blocked(ip, allowPrivate) {
  const value = ip.toLowerCase();
  if (value === '::' || value === '::1') return !allowPrivate;
  if (value.startsWith('fe80') || value.startsWith('fc') || value.startsWith('fd')) return !allowPrivate;
  if (value === 'fd00:ec2::254') return true;
  if (value.startsWith('::ffff:')) return isIpv4Blocked(value.slice(7), allowPrivate);
  if (value.startsWith('ff')) return true;
  return false;
}

function isBlockedAddress(ip, allowPrivate) {
  const version = net.isIP(ip);
  if (version === 4) return isIpv4Blocked(ip, allowPrivate);
  if (version === 6) return isIpv6Blocked(ip, allowPrivate);
  return true;
}

export async function assertUrlAllowed(rawUrl, { allowPrivate = false } = {}) {
  let url;
  try {
    url = new URL(String(rawUrl).trim());
  } catch {
    throw new Error('链接格式无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('只支持 http/https 链接');
  }
  if (url.username !== '' || url.password !== '') {
    throw new Error('链接中不能包含账号密码');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (host === '') throw new Error('链接缺少主机名');
  if (net.isIP(host)) {
    if (isBlockedAddress(host, allowPrivate)) throw new Error('该地址被安全策略拦截（本地网络或元数据地址）');
    return url;
  }
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error(`无法解析域名 ${host}`);
  }
  if (records.length === 0) throw new Error(`无法解析域名 ${host}`);
  for (const record of records) {
    if (isBlockedAddress(record.address, allowPrivate)) {
      throw new Error(`${host} 解析到受限地址，已拦截`);
    }
  }
  return url;
}

function decodeBody(buffer, contentType) {
  const match = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '');
  const charset = match?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset, { fatal: false }).decode(buffer);
  } catch {
    return buffer.toString('utf8');
  }
}

/**
 * Fetch a URL with the plugin's safety budgets.
 * @returns {{status:number, ok:boolean, headers:Record<string,string>, text:string,
 *   bytes:number, finalUrl:string, elapsedMs:number, contentType:string}}
 */
export async function safeFetch(rawUrl, options = {}) {
  const {
    method = 'GET',
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT,
    maxBytes = DEFAULT_MAX_BYTES,
    allowPrivate = false,
    redirects = 5,
    accept = 'application/rss+xml, application/atom+xml, text/calendar, application/json;q=0.9, text/html;q=0.8, */*;q=0.5',
  } = options;

  if (!['GET', 'HEAD'].includes(method.toUpperCase())) throw new Error('仅允许 GET/HEAD 请求');

  let current = String(rawUrl).trim();
  let hops = 0;
  let attempt = 0;
  const started = Date.now();

  for (;;) {
    await assertUrlAllowed(current, { allowPrivate });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(current, {
        method: method.toUpperCase(),
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'user-agent': USER_AGENT,
          accept,
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
          ...headers,
        },
      });
    } catch (error) {
      clearTimeout(timer);
      if (error?.name === 'AbortError') throw new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`);
      // 瞬时网络错误（DNS 抖动、连接被重置）重试一次，超时不重试以免拖长整体生成。
      if (attempt < 1) {
        attempt += 1;
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }
      throw new Error(`请求失败：${error?.message ?? error}`);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer);
      const location = response.headers.get('location');
      if (!location) throw new Error(`重定向缺少目标（${response.status}）`);
      if (hops >= redirects) throw new Error('重定向次数过多');
      hops += 1;
      attempt = 0;
      current = new URL(location, current).href;
      continue;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > maxBytes) {
      clearTimeout(timer);
      throw new Error(`内容过大（${Math.round(declared / 1024)} KB）`);
    }

    const chunks = [];
    let total = 0;
    try {
      if (response.body) {
        for await (const chunk of response.body) {
          total += chunk.length;
          if (total > maxBytes) {
            controller.abort();
            throw new Error(`内容超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`);
          }
          chunks.push(Buffer.from(chunk));
        }
      }
    } catch (error) {
      clearTimeout(timer);
      throw error instanceof Error && error.message.includes('上限') ? error : new Error(`读取内容失败：${error?.message ?? error}`);
    } finally {
      clearTimeout(timer);
    }

    const buffer = Buffer.concat(chunks);
    return {
      status: response.status,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries()),
      text: decodeBody(buffer, contentType),
      bytes: buffer.length,
      finalUrl: current,
      elapsedMs: Date.now() - started,
      contentType,
    };
  }
}

/** Read the peer certificate of an HTTPS endpoint (never trusts it). */
export function tlsCertificateInfo(rawUrl, timeoutMs = 8000) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.resolve(null);
  }
  if (url.protocol !== 'https:') return Promise.resolve(null);
  const port = Number(url.port || 443);
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const socket = tls.connect(
      {
        host: url.hostname,
        port,
        servername: url.hostname,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        try {
          const certificate = socket.getPeerCertificate();
          const validTo = certificate?.valid_to ? new Date(certificate.valid_to) : null;
          const daysLeft = validTo ? Math.floor((validTo.getTime() - Date.now()) / 86400000) : null;
          socket.end();
          done({
            issuer: certificate?.issuer?.O ?? certificate?.issuer?.CN ?? '',
            subject: certificate?.subject?.CN ?? '',
            validTo: validTo ? validTo.toISOString() : '',
            daysLeft,
          });
        } catch {
          socket.destroy();
          done(null);
        }
      },
    );
    socket.on('error', () => {
      socket.destroy();
      done(null);
    });
    socket.on('timeout', () => {
      socket.destroy();
      done(null);
    });
  });
}
