/**
 * Decide whether the ambient proxy settings point at something alive.
 *
 * Both the DSH host and Windows Task Scheduler can leave HTTPS_PROXY behind
 * after Clash Verge exits. Node's fetch then sends every request to a closed
 * port and waits for its own timeout, which is how one dead proxy turned a
 * two-minute briefing into five minutes of "获取超时". Probing the port once is
 * cheap; the answer is cached for a minute.
 */
import net from 'node:net';

export const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
];

export function proxyFromEnv(env = process.env) {
  for (const key of PROXY_ENV_KEYS) {
    const raw = env?.[key];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const value = String(raw).trim();
    const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `http://${value}`;
    try {
      const url = new URL(candidate);
      const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
      if (!url.hostname || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
      return { url: `${url.protocol}//${url.hostname}:${port}`, host: url.hostname, port };
    } catch {
      continue;
    }
  }
  return null;
}

export function probeProxy(proxy, timeoutMs = 400) {
  if (!proxy?.host || !proxy?.port) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const socket = net.connect({ host: proxy.host, port: proxy.port });
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

const cache = new Map();
const CACHE_TTL_MS = 60_000;

/** The proxy in the environment, but only when its port actually accepts a connection. */
export async function usableProxy({ env = process.env, timeoutMs = 400, ttlMs = CACHE_TTL_MS } = {}) {
  const proxy = proxyFromEnv(env);
  if (!proxy) return null;
  const now = Date.now();
  const hit = cache.get(proxy.url);
  if (hit && now - hit.at < ttlMs) return hit.ok ? proxy : null;
  const ok = await probeProxy(proxy, timeoutMs);
  cache.set(proxy.url, { at: now, ok });
  return ok ? proxy : null;
}

export function resetProxyCache() {
  cache.clear();
}

/**
 * Remove dead proxy variables from a child-process environment. A live proxy
 * is left untouched, so a running Clash still gets used.
 */
export async function sanitizeProxyEnv(env = process.env, { probe = probeProxy, timeoutMs = 400 } = {}) {
  const cleaned = { ...env };
  const proxy = proxyFromEnv(cleaned);
  const alive = proxy ? await probe(proxy, timeoutMs) : false;
  if (!alive) {
    for (const key of PROXY_ENV_KEYS) delete cleaned[key];
    delete cleaned.NODE_USE_ENV_PROXY;
  }
  return cleaned;
}
