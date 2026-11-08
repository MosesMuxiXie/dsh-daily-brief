/**
 * ManageBac collector. The robust path is the public ICS calendar subscription
 * URL that ManageBac exposes per class. Without it we replay a saved Cookie
 * against the dashboard and surface class/announcement links.
 */
import { collectIcs } from './ics.js';
import { extractLinks } from './page.js';
import { safeFetch } from '../fetch.js';
import { readSourceHeaders } from '../secrets.js';

function authError(message) {
  const error = new Error(message);
  error.code = 'AUTH';
  return error;
}

export async function collectManageBac(source, context = {}) {
  if (source.options.icsUrl) {
    const result = await collectIcs({ ...source, url: source.options.icsUrl }, context);
    return { ...result, note: result.note || 'ManageBac 日历订阅' };
  }
  const headers = await readSourceHeaders(context.storeDir, source.id);
  if (!headers || Object.keys(headers).length === 0) {
    throw authError('请粘贴 ManageBac 日历订阅链接（推荐），或在高级设置中保存登录 Cookie');
  }
  const url = source.url || source.options.icsUrl || 'https://www.managebac.com/student';
  const response = await safeFetch(url, {
    headers: { accept: 'text/html,application/xhtml+xml', ...headers },
    timeoutMs: 20000,
    maxBytes: 2 * 1024 * 1024,
  });
  const links = extractLinks(response.text, response.finalUrl, { allowExternal: false })
    .filter((item) => /\/(classes|calendar|announcements|tasks|events)\b/i.test(item.url))
    .slice(0, source.options.limit ?? 8)
    .map((item) => ({ ...item, badge: 'ManageBac', tone: 'accent' }));
  if (links.length === 0) {
    throw new Error('页面没有可识别的 ManageBac 条目（可能登录已过期，或页面结构已变化）');
  }
  return {
    items: links,
    status: 'ok',
    note: 'ManageBac 网页（Cookie 登录）',
    bytes: response.bytes,
    elapsedMs: response.elapsedMs,
  };
}
