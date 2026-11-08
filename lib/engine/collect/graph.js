/**
 * Microsoft Graph: device-code sign-in + Outlook mail / calendar / To Do.
 *
 * The device flow is split into one-step calls so the Host route can return the
 * code immediately and the client polls without holding an HTTP request open.
 */
import { formatDateTime, truncate } from '../text.js';
import { readSourceSecret, writeSourceSecret } from '../secrets.js';

const AUTHORITY = 'https://login.microsoftonline.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPES = 'offline_access User.Read Mail.Read Calendars.Read Tasks.Read';

function authError(message) {
  const error = new Error(message);
  error.code = 'AUTH';
  return error;
}

function form(params) {
  return new URLSearchParams(params).toString();
}

async function postForm(url, params) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: form(params),
  });
  const data = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, data };
}

export async function startDeviceFlow(clientId, tenant = 'common') {
  if (!clientId) throw new Error('请先在设置中填写 Microsoft 应用（客户端）ID');
  const url = `${AUTHORITY}/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0/devicecode`;
  const { ok, data } = await postForm(url, { client_id: clientId, scope: SCOPES });
  if (!ok) throw new Error(data.error_description ?? '无法启动设备登录');
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
    message: data.message,
    interval: data.interval ?? 5,
    expiresIn: data.expires_in ?? 900,
  };
}

/** One poll attempt; the client repeats it every `interval` seconds. */
export async function pollDeviceToken(clientId, deviceCode, tenant = 'common') {
  const url = `${AUTHORITY}/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0/token`;
  const { data } = await postForm(url, {
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: clientId,
    device_code: deviceCode,
  });
  if (data.error === 'authorization_pending') return { status: 'pending' };
  if (data.error === 'slow_down') return { status: 'slow_down' };
  if (data.error) return { status: 'error', error: data.error_description ?? data.error };
  return {
    status: 'ok',
    token: {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 - 60000,
      scope: data.scope ?? '',
    },
  };
}

async function refresh(clientId, token, tenant = 'common') {
  if (!token.refreshToken) throw authError('Microsoft 登录已过期，请重新连接');
  const url = `${AUTHORITY}/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0/token`;
  const { ok, data } = await postForm(url, {
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: token.refreshToken,
    scope: SCOPES,
  });
  if (!ok) throw authError('Microsoft 登录已过期，请重新连接');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? token.refreshToken,
    expiresAt: Date.now() + Number(data.expires_in ?? 3600) * 1000 - 60000,
  };
}

async function graphGet(token, path) {
  const response = await fetch(`${GRAPH}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (response.status === 401) throw authError('Microsoft 授权失效');
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('retry-after') ?? 3);
    await new Promise((resolve) => setTimeout(resolve, Math.min(retryAfter, 10) * 1000));
    return graphGet(token, path);
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Microsoft Graph ${response.status}：${text.slice(0, 160)}`);
  }
  return response.json();
}

async function loadToken(source, context, clientId) {
  const storeDir = context.storeDir;
  let token = null;
  const raw = await readSourceSecret(storeDir, source.id, 'token');
  if (raw) {
    try {
      token = JSON.parse(raw);
    } catch {
      token = null;
    }
  }
  if (!token?.accessToken) throw authError('尚未连接 Microsoft 账号');
  if (Number(token.expiresAt ?? 0) < Date.now()) {
    token = await refresh(clientId, token);
    await writeSourceSecret(storeDir, source.id, 'token', JSON.stringify(token));
  }
  return token;
}

function mailItems(payload) {
  return (payload.value ?? []).map((message) => ({
    id: message.id,
    title: truncate(String(message.subject ?? '（无主题）'), 160),
    url: message.webLink ?? '',
    detail: [
      message.from?.emailAddress?.name || message.from?.emailAddress?.address || '未知发件人',
      message.isRead ? '' : '未读',
      Array.isArray(message.toRecipients) && message.toRecipients.length > 1 ? '群发' : '',
    ]
      .filter(Boolean)
      .join(' · '),
    date: message.receivedDateTime ?? '',
    meta: formatDateTime(message.receivedDateTime, source.timezone ?? 'Asia/Shanghai'),
    badge: message.isRead ? '' : '未读',
    tone: message.isRead ? '' : 'accent',
  }));
}

function eventItems(payload) {
  return (payload.value ?? []).map((event) => ({
    id: event.id,
    title: truncate(String(event.subject ?? '日程'), 160),
    url: event.webLink ?? '',
    detail: event.location?.displayName ? String(event.location.displayName) : '',
    date: event.start?.dateTime ? new Date(`${event.start.dateTime}Z`).toISOString() : '',
    meta: formatDateTime(event.start?.dateTime, source.timezone ?? 'Asia/Shanghai'),
    badge: event.isAllDay ? '全天' : '',
    tone: '',
  }));
}

async function collectTasks(token, context, source) {
  const lists = await graphGet(token, '/me/todo/lists?$top=20');
  const items = [];
  for (const list of (lists.value ?? []).slice(0, 6)) {
    if (items.length >= (source.options.limit ?? 8)) break;
    try {
      const tasks = await graphGet(
        token,
        `/me/todo/lists/${encodeURIComponent(list.id)}/tasks?$top=8&$filter=${encodeURIComponent("status ne 'completed'")}`,
      );
      for (const task of tasks.value ?? []) {
        items.push({
          id: task.id,
          title: truncate(String(task.title ?? '任务'), 160),
          url: '',
          detail: [list.displayName, task.importance === 'high' ? '重要' : ''].filter(Boolean).join(' · '),
          date: task.dueDateTime?.dateTime ? new Date(`${task.dueDateTime.dateTime}Z`).toISOString() : '',
          meta: task.dueDateTime?.dateTime
            ? formatDateTime(task.dueDateTime.dateTime, source.timezone ?? 'Asia/Shanghai')
            : '无截止日期',
          badge: task.importance === 'high' ? '重要' : '',
          tone: task.importance === 'high' ? 'warn' : '',
        });
      }
    } catch {
      /* a single broken list must not hide the rest */
    }
  }
  items.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  return items;
}

export async function collectGraph(source, context = {}) {
  const clientId = context.config?.graph?.clientId ?? '';
  const token = await loadToken(source, context, clientId);
  const section = source.section;
  let items = [];
  if (section === 'tasks') {
    items = await collectTasks(token.accessToken, context, source);
  } else if (section === 'calendar') {
    const now = new Date();
    const end = new Date(now.getTime() + 48 * 3600000);
    const payload = await graphGet(
      token.accessToken,
      `/me/calendarView?startDateTime=${encodeURIComponent(now.toISOString())}&endDateTime=${encodeURIComponent(
        end.toISOString(),
      )}&$select=subject,start,location,webLink,isAllDay&$orderby=${encodeURIComponent('start/dateTime')}&$top=8`,
    );
    items = eventItems(payload);
  } else {
    const payload = await graphGet(
      token.accessToken,
      '/me/mailFolders/inbox/messages?$top=8&$select=subject,from,receivedDateTime,isRead,webLink,toRecipients&$orderby=receivedDateTime desc',
    );
    items = mailItems(payload);
  }
  return {
    items: items.slice(0, source.options.limit ?? 8),
    status: 'ok',
    note: section === 'tasks' ? 'Microsoft To Do' : section === 'calendar' ? 'Outlook 日历' : 'Outlook 收件箱',
    elapsedMs: 0,
  };
}

export async function connectGraphSource(source, context, clientId) {
  const token = await loadToken(source, context, clientId).catch(() => null);
  return Boolean(token);
}

export { SCOPES as GRAPH_SCOPES };
