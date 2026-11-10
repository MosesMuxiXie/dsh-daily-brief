/**
 * Host HTTP surface used by the client panel (relative `api/daily-brief/*`).
 *
 * The plugin owns this route, so it also owns the request policy. On hosts that
 * expose DSH's Connection service every call passes the same Host/Origin fence
 * and browser-session check as the built-in `/api` bridge
 * (`connection.requestRejection`). That covers both the Web GUI and the Desktop
 * renderer: the `dsh-app` scheme forwards an authenticated, same-origin request
 * for the panel, so no plugin-specific header is needed.
 *
 * Hosts without that service keep the historical local-only gate, now strict:
 * the request must come from loopback *and* carry `x-daily-brief-client: 1`.
 */
const PREFIX = '/api/daily-brief';
const CLIENT_HEADER = 'x-daily-brief-client';

function isLoopback(req) {
  const address = req.socket?.remoteAddress || '';
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

/**
 * Decide whether one request may reach the panel API.
 * @returns `undefined` when admitted, otherwise the status and error to answer with.
 */
function admissionFailure(ctx, req) {
  let connection;
  try {
    connection = typeof ctx.get === 'function' ? ctx.get('connection') : ctx.connection;
  } catch {
    connection = undefined;
  }
  if (connection && typeof connection.requestRejection === 'function') {
    try {
      const status = connection.requestRejection(req);
      if (!status) return undefined;
      return {
        status,
        error: status === 401 ? '需要 DSH 网页会话认证' : '请求来源不受信任',
      };
    } catch {
      return { status: 503, error: '暂时无法校验请求来源' };
    }
  }
  if (!isLoopback(req)) return { status: 403, error: '仅限本机访问' };
  if (req.headers[CLIENT_HEADER] !== '1') return { status: 403, error: '客户端标识无效' };
  return undefined;
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body ?? null);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(payload);
}

function readBody(req, limit = 2_000_000) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.trim() === '') return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function registerRoutes(ctx, service) {
  const handler = async (req, res) => {
    let url;
    try {
      url = new URL(req.url || '/', 'http://127.0.0.1');
    } catch {
      sendJson(res, 400, { error: '无效的请求' });
      return;
    }
    const sub = url.pathname.slice(PREFIX.length) || '/';
    const method = req.method || 'GET';

    const failure = admissionFailure(ctx, req);
    if (failure) {
      sendJson(res, failure.status, { error: failure.error });
      return;
    }

    // `/artifact` has no panel client of its own; admission above is the guard.
    if (sub === '/artifact' && method === 'GET') {
      const id = url.searchParams.get('id') || 'latest';
      const briefing = await service.getBriefing(id);
      if (!briefing.ok) {
        sendJson(res, 404, briefing);
        return;
      }
      const html = briefing.html || '';
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('cache-control', 'no-store');
      res.setHeader(
        'content-security-policy',
        "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'",
      );
      if (url.searchParams.get('download') === '1') {
        res.setHeader(
          'content-disposition',
          `attachment; filename="daily-brief-${briefing.id}.html"; filename*=UTF-8''${encodeURIComponent(
            `每日简报-${briefing.id}.html`,
          )}`,
        );
      }
      res.end(html);
      return;
    }

    try {
      if (sub === '/state' && method === 'GET') {
        sendJson(res, 200, await service.getState());
        return;
      }
      if (sub === '/health' && method === 'GET') {
        sendJson(res, 200, { ok: true, version: 1 });
        return;
      }
      if (sub === '/briefing' && method === 'GET') {
        const id = url.searchParams.get('id') || 'latest';
        const briefing = await service.getBriefing(id);
        sendJson(res, briefing.ok ? 200 : 404, briefing);
        return;
      }
      if (method !== 'POST') {
        sendJson(res, 405, { error: '不支持的请求方法' });
        return;
      }

      const body = await readBody(req);
      switch (sub) {
        case '/config':
          sendJson(res, 200, await service.saveConfig(body.patch || body));
          return;
        case '/probe':
          sendJson(res, 200, await service.probe(body.text, body.section));
          return;
        case '/steam/library':
          sendJson(res, 200, await service.steamLibrary());
          return;
        case '/import':
          sendJson(res, 200, await service.importText(body.text, body.section));
          return;
        case '/sources':
          sendJson(res, 200, await service.addSources(body.proposals || body.sources || []));
          return;
        case '/source/test':
          sendJson(res, 200, await service.testSource(body.id));
          return;
        case '/source/update':
          sendJson(res, 200, await service.updateSource(body.id, body.patch || {}));
          return;
        case '/source/remove':
          sendJson(res, 200, await service.removeSource(body.id));
          return;
        case '/secret':
          sendJson(res, 200, await service.setSecret(body));
          return;
        case '/graph/start':
          sendJson(res, 200, await service.graphStart(body.sourceId));
          return;
        case '/graph/poll':
          sendJson(res, 200, await service.graphPoll(body.sourceId));
          return;
        case '/run':
          sendJson(res, 200, await service.run({ dryRun: Boolean(body.dryRun), force: body.force !== false }));
          return;
        case '/schedule':
          sendJson(res, 200, await service.scheduleAction(body.action || 'query'));
          return;
        case '/open':
          sendJson(res, 200, await service.openFolder(body.which || 'store'));
          return;
        case '/popup':
          sendJson(res, 200, body.id ? await service.openPopup(body.id) : await service.testPopup());
          return;
        case '/launcher':
          sendJson(res, 200, { ok: true, file: service.launcherFile(), cmd: service.runCmdFile() });
          return;
        default:
          sendJson(res, 404, { error: '未知接口' });
      }
    } catch (error) {
      sendJson(res, 500, { error: String(error?.message || error).slice(0, 800) });
    }
  };

  const dispose = ctx.webServer.register({ kind: 'prefix', path: PREFIX, handler });
  return () => {
    try {
      dispose?.();
    } catch {
      // ignore
    }
  };
}
