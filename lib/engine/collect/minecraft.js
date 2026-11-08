/**
 * Minecraft server status.
 *
 * Speaks the Java status protocol directly (no dependency, no third-party
 * uptime service), and falls back to mcstatus.io when the network path to the
 * server is blocked. One item is produced for the briefing card, plus a
 * structured `server` payload the renderer turns into a status strip.
 */
import dns from 'node:dns/promises';
import net from 'node:net';
import { safeFetch } from '../fetch.js';

function varInt(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let byte = v & 0x7f;
    v >>>= 7;
    if (v !== 0) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function mcString(value) {
  const body = Buffer.from(value, 'utf8');
  return Buffer.concat([varInt(body.length), body]);
}

function handshake(host, port) {
  const body = Buffer.concat([
    varInt(0), // packet id
    varInt(767), // protocol version (1.21.x); status ignores it
    mcString(host),
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    varInt(1), // next state: status
  ]);
  return Buffer.concat([varInt(body.length), body]);
}

const STATUS_REQUEST = Buffer.from([0x01, 0x00]);

function readVarInt(buffer, offset = 0) {
  let value = 0;
  let size = 0;
  let byte;
  do {
    if (offset + size >= buffer.length || size > 5) return null;
    byte = buffer[offset + size];
    value |= (byte & 0x7f) << (7 * size);
    size += 1;
  } while (byte & 0x80);
  return { value, size };
}

async function resolveSrv(host, port) {
  if (port !== 25565) return { host, port };
  try {
    const records = await dns.resolveSrv(`_minecraft._tcp.${host}`);
    if (Array.isArray(records) && records.length > 0) {
      return { host: records[0].name, port: records[0].port };
    }
  } catch {
    /* no SRV record, use the plain host */
  }
  return { host, port };
}

export function pingJava(host, port = 25565, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    let buffer = Buffer.alloc(0);
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };

    socket.setTimeout(timeoutMs);
    socket.on('timeout', () => finish(new Error('连接超时')));
    socket.on('error', (error) => finish(error));
    socket.on('connect', () => {
      socket.write(handshake(host, port));
      socket.write(STATUS_REQUEST);
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      const length = readVarInt(buffer, 0);
      if (!length) return;
      const total = length.size + length.value;
      if (buffer.length < total) return;
      let cursor = length.size;
      const packetId = readVarInt(buffer, cursor);
      if (!packetId) return finish(new Error('返回数据无法解析'));
      cursor += packetId.size;
      const strLen = readVarInt(buffer, cursor);
      if (!strLen) return finish(new Error('返回数据无法解析'));
      cursor += strLen.size;
      let json;
      try {
        json = JSON.parse(buffer.subarray(cursor, cursor + strLen.value).toString('utf8'));
      } catch {
        return finish(new Error('返回数据不是 JSON'));
      }
      const players = json?.players ?? {};
      finish(null, {
        online: true,
        latency: Date.now() - started,
        version: typeof json?.version?.name === 'string' ? json.version.name : '',
        motd: motdText(json?.description),
        players: {
          online: Number(players.online) || 0,
          max: Number(players.max) || 0,
          sample: Array.isArray(players.sample) ? players.sample.slice(0, 6).map((player) => player?.name).filter(Boolean) : [],
        },
        software: '',
        source: 'ping',
      });
    });
  });
}

function motdText(description) {
  if (typeof description === 'string') return description.replace(/§./g, '').trim();
  if (description && typeof description === 'object') {
    const parts = [];
    if (typeof description.text === 'string') parts.push(description.text);
    if (Array.isArray(description.extra)) {
      for (const part of description.extra) {
        if (typeof part === 'string') parts.push(part);
        else if (typeof part?.text === 'string') parts.push(part.text);
      }
    }
    return parts.join('').replace(/§./g, '').replace(/\s+/g, ' ').trim();
  }
  return '';
}

async function apiStatus(host, port) {
  const response = await safeFetch(`https://api.mcstatus.io/v2/status/java/${host}:${port}`, {
    timeoutMs: 8000,
    maxBytes: 1024 * 1024,
  });
  if (!response.ok) throw new Error(`状态接口返回 ${response.status}`);
  const data = JSON.parse(response.text);
  return {
    online: Boolean(data.online),
    latency: Number(data.debug?.ping) || 0,
    version: data.version?.name_raw || data.version?.name_clean || '',
    motd: typeof data.motd?.clean === 'string' ? data.motd.clean.trim() : '',
    players: {
      online: Number(data.players?.online) || 0,
      max: Number(data.players?.max) || 0,
      sample: Array.isArray(data.players?.list)
        ? data.players.list.slice(0, 6).map((player) => player?.name_clean).filter(Boolean)
        : [],
    },
    software: data.software || '',
    source: 'mcstatus.io',
  };
}

export async function collectMinecraft(source, context = {}) {
  const started = Date.now();
  const rawHost = String(source.options?.host || '').trim();
  if (rawHost === '') return { status: 'error', items: [], note: '没有填写服务器地址', elapsedMs: 0 };
  let host = rawHost;
  let port = Number(source.options?.port) || 25565;
  const match = /^([^:]+):(\d+)$/.exec(host);
  if (match) {
    host = match[1];
    port = Number(match[2]);
  }

  let server = null;
  let note = '';
  try {
    const target = await resolveSrv(host, port);
    server = await pingJava(target.host, target.port, 6000);
  } catch (error) {
    try {
      server = await apiStatus(host, port);
      note = '通过状态接口查询';
    } catch {
      server = {
        online: false,
        latency: 0,
        version: '',
        motd: '',
        players: { online: 0, max: 0, sample: [] },
        software: '',
        source: 'none',
        reason: String(error?.message || error).slice(0, 120),
      };
      note = '连不上服务器，按离线处理';
    }
  }

  const address = `${host}:${port}`;
  const online = Boolean(server.online);
  const playerLine =
    online && server.players.max > 0 ? `${server.players.online}/${server.players.max} 人在线` : online ? '在线' : '离线';
  const detailParts = [];
  if (online) {
    if (server.motd) detailParts.push(server.motd);
    if (server.version) detailParts.push(server.version);
    if (server.latency > 0) detailParts.push(`${server.latency} ms`);
  } else {
    detailParts.push(server.reason ? `没有响应 · ${server.reason}` : '服务器当前没有开服');
  }

  const item = {
    id: `mc-${address}`,
    title: online ? `服务器在线 · ${playerLine}` : '服务器离线',
    detail: detailParts.join(' · '),
    url: '',
    date: new Date().toISOString(),
    meta: address,
    badge: online ? '在线' : '离线',
    tone: online ? 'good' : 'bad',
  };

  return {
    status: online ? 'ok' : 'skipped',
    items: [item],
    note,
    elapsedMs: Date.now() - started,
    server: {
      online,
      host,
      port,
      address,
      label: source.label,
      players: server.players,
      version: server.version,
      motd: server.motd,
      latency: server.latency,
      source: server.source,
    },
  };
}
