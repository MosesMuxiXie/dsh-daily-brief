/**
 * HTTP health monitor. Reports status code, latency, body keyword and the TLS
 * certificate lifetime; one item per endpoint.
 */
import { safeFetch, tlsCertificateInfo } from '../fetch.js';
import { hostOf } from '../text.js';

export async function collectHttp(source) {
  const started = Date.now();
  let response;
  try {
    response = await safeFetch(source.url, {
      method: source.options.method ?? 'GET',
      timeoutMs: 12000,
      maxBytes: 512 * 1024,
      allowPrivate: source.options.allowPrivate ?? true,
    });
  } catch (error) {
    return {
      items: [
        {
          id: source.id,
          title: `${source.label} 无法连接`,
          url: source.url,
          detail: error instanceof Error ? error.message : String(error),
          date: new Date().toISOString(),
          meta: hostOf(source.url),
          badge: '离线',
          tone: 'bad',
        },
      ],
      status: 'degraded',
      note: '连接失败',
      elapsedMs: Date.now() - started,
    };
  }

  const tls = await tlsCertificateInfo(source.url);
  const expected = Number(source.options.expectStatus ?? 200);
  const statusOk = source.options.expectStatus === 200 ? response.ok : response.status === expected;
  let keywordOk = true;
  if (source.options.keyword) keywordOk = response.text.includes(source.options.keyword);
  const healthy = statusOk && keywordOk;
  const reachable = response.status < 500;
  const seconds = (response.elapsedMs / 1000).toFixed(2);
  const tlsText = tls?.daysLeft !== undefined && tls.daysLeft !== null ? ` · 证书剩余 ${tls.daysLeft} 天` : '';
  const keywordText = source.options.keyword ? (keywordOk ? ' · 关键词命中' : ' · 关键词缺失') : '';
  const authText =
    !healthy && (response.status === 401 || response.status === 403) && keywordOk ? ' · 需要登录，但服务在线' : '';
  return {
    items: [
      {
        id: source.id,
        title: `${source.label} ${healthy ? '运行正常' : reachable ? '在线（需留意）' : '状态异常'}`,
        url: source.url,
        detail: `HTTP ${response.status} · ${seconds}s${tlsText}${keywordText}${authText}`,
        date: new Date().toISOString(),
        meta: hostOf(source.url),
        badge: healthy ? '在线' : `HTTP ${response.status}`,
        tone: healthy ? 'good' : reachable ? 'warn' : 'bad',
      },
    ],
    status: healthy ? 'ok' : reachable ? 'degraded' : 'degraded',
    note: tls?.issuer ? `证书签发者 ${tls.issuer}` : '',
    elapsedMs: Date.now() - started,
  };
}
