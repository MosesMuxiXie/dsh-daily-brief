/**
 * IMAP mailbox collector (envelope only: subject, sender, date, flags).
 * Works with any provider that offers IMAP; passwords live in DPAPI secrets.
 */
import { ImapFlow } from 'imapflow';
import { formatDateTime } from '../text.js';
import { readSourceSecret } from '../secrets.js';

function authError(message) {
  const error = new Error(message);
  error.code = 'AUTH';
  return error;
}

export async function collectImap(source, context = {}) {
  const storeDir = context.storeDir;
  if (!storeDir) throw new Error('缺少存储目录');
  const account = source.account ?? {};
  if (!account.user || !account.host) throw authError('请先填写邮箱地址与 IMAP 服务器');
  const password = await readSourceSecret(storeDir, source.id, 'password');
  if (!password) throw authError('尚未保存邮箱密码或授权码');

  const client = new ImapFlow({
    host: account.host,
    port: account.port ?? 993,
    secure: account.secure !== false,
    auth: { user: account.user, pass: password },
    logger: false,
    tls: { rejectUnauthorized: true },
  });
  const started = Date.now();
  try {
    await client.connect();
    const mailbox = source.options.mailbox || 'INBOX';
    const lock = await client.getMailboxLock(mailbox);
    try {
      const since = new Date(Date.now() - (source.options.sinceHours ?? 24) * 3600000);
      const uids = await client.search({ since }, { uid: true });
      if (uids.length === 0) {
        return { items: [], status: 'ok', note: '最近没有新邮件', elapsedMs: Date.now() - started };
      }
      const selected = uids.slice(-Math.min(Math.max(source.options.limit ?? 8, 1) * 3, 40));
      const messages = [];
      for await (const message of client.fetch(selected.join(','), { envelope: true, flags: true, uid: true }, { uid: true })) {
        const envelope = message.envelope ?? {};
        const from = envelope.from?.[0];
        const date = envelope.date ? new Date(envelope.date) : new Date();
        const unread = !(message.flags instanceof Set) || !message.flags.has('\\Seen');
        const subject = String(envelope.subject ?? '（无主题）').slice(0, 160);
        const sender = from?.name ? `${from.name}` : String(from?.address ?? '未知发件人');
        messages.push({
          id: `${source.id}-${message.uid ?? date.getTime()}`,
          title: subject,
          url: '',
          detail: `${sender}${unread ? ' · 未读' : ''}`,
          date: date.toISOString(),
          meta: formatDateTime(date, source.timezone ?? 'Asia/Shanghai'),
          badge: unread ? '未读' : '',
          tone: unread ? 'accent' : '',
        });
      }
      messages.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const items = messages.slice(0, source.options.limit ?? 8);
      const unreadCount = messages.filter((m) => m.badge === '未读').length;
      return {
        items,
        status: 'ok',
        note: unreadCount > 0 ? `${unreadCount} 封未读` : '',
        elapsedMs: Date.now() - started,
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/auth|login|credential|password/i.test(message)) throw authError(`邮箱登录失败：${message}`);
    throw error;
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore logout failures */
    }
  }
}
