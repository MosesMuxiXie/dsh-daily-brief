/**
 * Network readiness gate for scheduled runs.
 *
 * A laptop that woke from sleep a minute ago often has an adapter that is
 * still negotiating: DNS answers nothing, connections are refused, and every
 * source of the briefing reports "无法解析域名 …" in the same second. The
 * scheduled runner waits here until name resolution and one TCP handshake
 * actually work, instead of burning the whole run inside that window.
 */
import dns from 'node:dns/promises';
import net from 'node:net';

// Hosts that are reachable from a mainland network without a proxy. Probing
// x.com / youtube.com here would report "network down" on every normal
// morning, and the scheduled run would wait its full budget for nothing.
const PROBE_HOSTS = ['www.bing.com', 'api.bilibili.com', 'store.steampowered.com', 'www.baidu.com'];
const PROBE_TIMEOUT_MS = 4000;

function withTimeout(task, timeoutMs, fallback) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    task().then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

function lookupHost(host, timeoutMs) {
  return withTimeout(
    () => dns.lookup(host, { all: false }).then((record) => record?.address ?? ''),
    timeoutMs,
    '',
  );
}

function connectHost(host, port, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    let socket;
    const done = (ok) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      resolve(ok);
    };
    try {
      socket = net.connect({ host, port });
    } catch {
      resolve(false);
      return;
    }
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** One quick TCP reachability check, used to skip a guaranteed 14-second dead end. */
export async function hostReachable(host, port = 443, timeoutMs = 600) {
  if (!host) return false;
  const address = await lookupHost(host, timeoutMs);
  if (address === '') return false;
  return connectHost(address, port, timeoutMs);
}

/**
 * One probe: at least half of the hosts must resolve, and one of them must
 * accept a TCP connection. A single host is not enough — one name can come
 * from the hosts file or a stale cache while the rest of DNS is still dead.
 */
export async function probeNetwork({ hosts = PROBE_HOSTS, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const addresses = await Promise.all(hosts.map((host) => lookupHost(host, timeoutMs)));
  const resolved = addresses.filter(Boolean).length;
  const dnsOk = resolved >= Math.ceil(hosts.length / 2);
  if (!dnsOk) return { ok: false, resolved, total: hosts.length, tcp: null };
  // Try every resolved host, not just the first: one reachable name with a
  // filtered port must not make a working network look dead.
  let tcp = false;
  let target = '';
  for (let index = 0; index < hosts.length; index += 1) {
    if (!addresses[index]) continue;
    target = hosts[index];
    tcp = await connectHost(addresses[index], 443, timeoutMs);
    if (tcp) break;
  }
  return { ok: tcp, resolved, total: hosts.length, tcp, target };
}

/**
 * Wait until the network is usable, at most `timeoutMs`. When the budget runs
 * out the run continues anyway: a partial briefing from a flaky line still
 * beats no briefing at all.
 */
export async function waitForNetwork({
  hosts = PROBE_HOSTS,
  timeoutMs = 300_000,
  intervalMs = 5000,
  log = () => {},
} = {}) {
  const started = Date.now();
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const probe = await probeNetwork({ hosts });
    if (probe.ok) {
      if (attempt > 1) {
        log(`网络就绪（第 ${attempt} 次探测，等待 ${Math.round((Date.now() - started) / 1000)} 秒）`);
      }
      return { ok: true, attempts: attempt, waitedMs: Date.now() - started, probe };
    }
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) {
      log(`网络仍未就绪（${probe.resolved}/${probe.total} 域名可解析），继续尝试抓取`);
      return { ok: false, attempts: attempt, waitedMs: elapsed, probe };
    }
    log(
      `等待网络就绪（${probe.resolved}/${probe.total} 域名可解析，已等 ${Math.round(elapsed / 1000)} 秒）`,
    );
    await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, timeoutMs - elapsed)));
  }
}
