/**
 * Host-side operations for the Daily Brief panel. Everything the panel and the
 * agent tool can do is implemented exactly once here.
 */
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createStore, resolveStoreDir } from '../engine/store.js';
import {
  PERSONAS,
  SECTION_DEFS,
  mergeConfig,
  newSourceId,
  normalizeSource,
  publicConfig,
} from '../engine/config.js';
import { collectSource } from '../engine/collect/index.js';
import { steamLibrarySummary } from '../engine/steam-library.js';
import { probeMany } from '../engine/import/detect.js';
import { startDeviceFlow, pollDeviceToken } from '../engine/collect/graph.js';
import { renderBriefingHtml } from '../engine/render/html.js';
import {
  deleteSecret,
  deleteSourceSecrets,
  readSecret,
  readSourceSecret,
  secretsSupported,
  writeSecret,
  writeSourceSecret,
} from '../engine/secrets.js';
import { installTask, queryTask, removeTask, runCmdPath, writeRunCmd } from './schedule-task.js';
import { resolveDesktopRuntime } from '../engine/ai.js';
import { openBriefingWindow } from '../engine/popup.js';
import { runBriefing } from '../engine/runner.js';

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = path.join(PLUGIN_ROOT, 'lib', 'engine', 'runner.js');

/** A tiny stand-in used by the "试一下弹窗" button before the first briefing. */
function sampleBriefing() {
  const now = new Date();
  return {
    dateKey: now.toISOString().slice(0, 10),
    dateLabel: '示例简报',
    shortDate: `${now.getMonth() + 1} · ${now.getDate()}`,
    weekday: '',
    greeting: '晚上好',
    headline: '弹窗以后就长这样。',
    intro: '每天定时出现在桌面右下角，像记事本一样，关掉就好。',
    timeLabel: '07:30',
    timezone: 'Asia/Shanghai',
    stats: { items: 3 },
    warnings: [],
    sections: [
      {
        id: 'aiNews',
        zh: '新闻',
        accent: '#C2603F',
        items: [
          { title: 'OpenAI 发布一条新动态，这里只留标题和来源', url: '', sourceLabel: 'OpenAI', when: '2 小时前' },
          { title: '关注的账号又更新了一条', url: '', sourceLabel: 'AnthropicAI', when: '5 小时前' },
        ],
      },
      {
        id: 'gameNews',
        zh: '游戏',
        accent: '#8A4D6D',
        items: [{ title: 'ACE COMBAT 7 发布了一个更新说明', url: '', sourceLabel: 'Steam', when: '昨天' }],
      },
      {
        id: 'server',
        zh: '服务器',
        accent: '#2F7D63',
        items: [],
        server: {
          online: true,
          label: '我的世界服务器',
          address: 'play.simpfun.cn:11848',
          players: { online: 2, max: 10 },
          version: '1.21.1',
          latency: 42,
        },
      },
    ],
  };
}

export function createDailyBriefService(ctx, options = {}) {
  const store = createStore(options.storeDir || resolveStoreDir());
  const flows = new Map();
  let syncPromise = null;

  function exePath() {
    return process.execPath;
  }

  function listConfig() {
    return store.loadConfig();
  }

  function launcherFile() {
    return writeRunCmd({ storeDir: store.dir, exe: exePath(), runnerPath: RUNNER });
  }

  async function secretStatus(config) {
    const sources = {};
    for (const source of config.sources) {
      if (!['imap', 'graph', 'managebac', 'page'].includes(source.type)) continue;
      const status = {};
      if (source.type === 'imap') status.password = Boolean(await readSourceSecret(store.dir, source.id, 'password'));
      if (source.type === 'graph') status.token = Boolean(await readSourceSecret(store.dir, source.id, 'token'));
      if (source.type === 'managebac' || source.type === 'page') {
        status.cookie = Boolean(await readSourceSecret(store.dir, source.id, 'headers'));
      }
      sources[source.id] = status;
    }
    return {
      supported: secretsSupported(),
      smtpPassword: Boolean(await readSecret(store.dir, 'smtp:password')),
      sources,
    };
  }

  async function syncSchedule(config = store.loadConfig(), target) {
    if (syncPromise && !target) return syncPromise;
    const run = async () => {
      try {
        if (!config.schedule.enabled) {
          await removeTask();
          return { enabled: false, task: await queryTask() };
        }
        const task = await installTask({
          storeDir: store.dir,
          time: config.schedule.time,
          wakeToRun: config.schedule.wakeToRun,
          exe: exePath(),
          runnerPath: RUNNER,
        });
        return { enabled: true, task, error: '' };
      } catch (error) {
        return { enabled: config.schedule.enabled, task: { installed: false }, error: String(error.message || error).slice(0, 600) };
      }
    };
    if (target) return run();
    syncPromise = run().finally(() => {
      syncPromise = null;
    });
    return syncPromise;
  }

  async function getState() {
    const config = store.loadConfig();
    const state = store.loadState();
    const runtime = store.loadRuntime() || {};
    const briefings = store.listBriefings(30);
    const latest = briefings[0] ? store.readBriefing(briefings[0].id) : null;
    const task = await queryTask();
    const aiRuntime = resolveDesktopRuntime();
    return {
      capabilities: ['focus', 'popup', 'persona2', 'monitor', 'steamlib'],
      config: publicConfig(config),
      sources: config.sources,
      sections: SECTION_DEFS,
      personas: PERSONAS,
      briefings,
      latest: latest ? { data: latest.data, dir: latest.dir } : null,
      state,
      runtime: { ...runtime, aiAvailable: aiRuntime.available },
      schedule: { ...config.schedule, task },
      secrets: await secretStatus(config),
      paths: {
        store: store.dir,
        artifact: latest ? path.join(latest.dir, 'index.html') : '',
        launcher: runCmdPath(store.dir),
        runner: RUNNER,
      },
    };
  }

  async function saveConfig(patch) {
    const before = store.loadConfig();
    const next = { ...before, ...(patch || {}) };
    // A partial persona patch (e.g. only preset) must not drop saved cards.
    if (patch && patch.persona) next.persona = { ...(before.persona || {}), ...patch.persona };
    const saved = store.saveConfig(mergeConfig(next));
    const scheduleChanged =
      before.schedule.time !== saved.schedule.time ||
      before.schedule.enabled !== saved.schedule.enabled ||
      before.schedule.wakeToRun !== saved.schedule.wakeToRun;
    let schedule = null;
    if (scheduleChanged) schedule = await syncSchedule(saved, 'save');
    return { ok: true, config: publicConfig(saved), schedule, task: await queryTask() };
  }

  async function probe(text, section) {
    const result = await probeMany(String(text || ''), { section });
    return result;
  }

  function steamLibrary() {
    return steamLibrarySummary();
  }

  function proposalToSource(proposal, index) {
    return normalizeSource(
      {
        id: newSourceId(),
        type: proposal.type,
        section: proposal.section,
        label: proposal.label,
        url: proposal.url || '',
        account: proposal.account || undefined,
        options: proposal.options || {},
        enabled: true,
        order: Date.now() / 1000 + index,
      },
      index,
    );
  }

  async function addSources(proposals) {
    const config = store.loadConfig();
    const existing = new Set(config.sources.map((source) => `${source.type}|${source.url || source.account || source.label}`));
    const added = [];
    for (const [index, proposal] of (proposals || []).entries()) {
      if (!proposal || !proposal.type) continue;
      const source = proposalToSource(proposal, index);
      const key = `${source.type}|${source.url || source.account || source.label}`;
      if (existing.has(key)) continue;
      existing.add(key);
      config.sources.push(source);
      added.push(source);
    }
    if (added.length > 0) store.saveConfig(config);
    return { ok: true, added, sources: store.loadConfig().sources };
  }

  async function importText(text, section) {
    const probed = await probe(text, section);
    const usable = probed.results.filter((item) => item.ok);
    const added = await addSources(usable);
    return { ...probed, added: added.added, sources: added.sources };
  }

  async function updateSource(id, patch) {
    const config = store.loadConfig();
    const index = config.sources.findIndex((source) => source.id === id);
    if (index < 0) throw new Error('来源不存在');
    const merged = normalizeSource({ ...config.sources[index], ...(patch || {}), id }, index);
    config.sources[index] = merged;
    store.saveConfig(config);
    return { ok: true, source: merged, sources: config.sources };
  }

  async function removeSource(id) {
    const config = store.loadConfig();
    config.sources = config.sources.filter((source) => source.id !== id);
    store.saveConfig(config);
    await deleteSourceSecrets(store.dir, id);
    return { ok: true, sources: config.sources };
  }

  async function testSource(id) {
    const config = store.loadConfig();
    const source = config.sources.find((item) => item.id === id);
    if (!source) throw new Error('来源不存在');
    const result = await collectSource(source, { storeDir: store.dir, config, now: new Date() });
    return {
      ok: result.status === 'ok' || result.status === 'degraded',
      status: result.status,
      note: result.note || '',
      elapsedMs: result.elapsedMs,
      items: result.items.slice(0, 5),
    };
  }

  async function setSecret({ key, sourceId, field, value }) {
    if (sourceId) {
      if (!['password', 'token', 'headers'].includes(field)) throw new Error('不支持的密钥字段');
      if (field === 'headers') {
        const headers = typeof value === 'string' ? JSON.parse(value) : value;
        await writeSourceSecret(store.dir, sourceId, 'headers', JSON.stringify(headers || {}));
      } else if (value) {
        await writeSourceSecret(store.dir, sourceId, field, String(value));
      } else {
        await writeSourceSecret(store.dir, sourceId, field, '');
      }
      return { ok: true, secrets: await secretStatus(store.loadConfig()) };
    }
    if (key !== 'smtp:password') throw new Error('不支持的密钥');
    if (value) await writeSecret(store.dir, key, String(value));
    else await deleteSecret(store.dir, key);
    return { ok: true, secrets: await secretStatus(store.loadConfig()) };
  }

  async function graphStart(sourceId) {
    const config = store.loadConfig();
    const source = config.sources.find((item) => item.id === sourceId);
    if (!source) throw new Error('来源不存在');
    if (!config.graph.clientId) throw new Error('请先填写 Microsoft Azure 应用（客户端）ID');
    const flow = await startDeviceFlow(config.graph.clientId);
    flows.set(sourceId, { deviceCode: flow.deviceCode, startedAt: Date.now(), expiresIn: flow.expiresIn });
    return { ok: true, ...flow };
  }

  async function graphPoll(sourceId) {
    const config = store.loadConfig();
    const flow = flows.get(sourceId);
    if (!flow) return { status: 'expired', error: '登录流程已过期，请重新开始' };
    if (Date.now() - flow.startedAt > flow.expiresIn * 1000) {
      flows.delete(sourceId);
      return { status: 'expired', error: '登录流程已过期，请重新开始' };
    }
    const result = await pollDeviceToken(config.graph.clientId, flow.deviceCode);
    if (result.status === 'ok') {
      await writeSourceSecret(store.dir, sourceId, 'token', JSON.stringify(result.token));
      flows.delete(sourceId);
      return { status: 'ok' };
    }
    return result;
  }

  async function run({ dryRun = false, force = true } = {}) {
    if (dryRun) {
      const result = await runBriefing({ store: store.dir, dryRun: true, force: true, trigger: 'preview' });
      return {
        ok: result.ok,
        dryRun: true,
        dateKey: result.dateKey,
        briefing: result.briefing,
        html: result.html || '',
        previewText: result.email?.text || '',
        elapsedMs: result.elapsedMs,
      };
    }
    launcherFile();
    const env = { ...process.env };
    if (process.versions.electron) env.ELECTRON_RUN_AS_NODE = '1';
    const child = spawn(
      process.execPath,
      [RUNNER, '--store', store.dir, '--force', '--trigger', 'manual'],
      { detached: true, stdio: 'ignore', windowsHide: true, env },
    );
    child.unref();
    return { ok: true, started: true, pid: child.pid };
  }

  async function getBriefing(id) {
    const config = store.loadConfig();
    let key = id;
    if (!key || key === 'latest') {
      const rows = store.listBriefings(1);
      key = rows[0]?.id;
    }
    if (!key) return { ok: false, error: '还没有简报' };
    const item = store.readBriefing(key);
    if (!item) return { ok: false, error: '找不到这份简报' };
    return {
      ok: true,
      id: key,
      data: item.data,
      html: item.html,
      dir: item.dir,
      file: path.join(item.dir, 'index.html'),
      timezone: config.timezone,
    };
  }

  async function openFolder(which = 'store') {
    const target = which === 'briefing' ? (await getBriefing('latest')).dir : store.dir;
    if (!target) return { ok: false, error: '还没有简报' };
    const child = spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true });
    child.unref();
    return { ok: true, path: target };
  }

  function popupOptions() {
    const popup = store.loadConfig().delivery?.popup || {};
    return {
      width: popup.width,
      height: popup.height,
      position: popup.position,
      profileDir: path.join(store.dir, '.popup-profile'),
    };
  }

  async function openPopup(id) {
    const briefing = await getBriefing(id || 'latest');
    if (!briefing.ok) return { ok: false, error: briefing.error || '还没有简报' };
    const result = await openBriefingWindow(briefing.file, popupOptions());
    return { ...result, id: briefing.id, file: briefing.file };
  }

  async function testPopup() {
    const latest = await getBriefing('latest');
    if (latest.ok) return openPopup('latest');
    const file = path.join(store.dir, 'popup-preview.html');
    writeFileSync(file, renderBriefingHtml(sampleBriefing()), 'utf8');
    const result = await openBriefingWindow(file, popupOptions());
    return { ...result, id: 'sample', file };
  }

  async function scheduleAction(action) {
    const config = store.loadConfig();
    if (action === 'install') {
      const enabled = store.saveConfig({ ...config, schedule: { ...config.schedule, enabled: true } });
      const result = await syncSchedule(enabled, 'route');
      return { ok: Boolean(result.task?.installed), ...result };
    }
    if (action === 'remove') {
      store.saveConfig({ ...config, schedule: { ...config.schedule, enabled: false } });
      await removeTask();
      return { ok: true, task: await queryTask() };
    }
    return { ok: true, task: await queryTask() };
  }

  // Best effort: keep the scheduled task in sync when the plugin loads in Desktop.
  if (process.versions.electron) {
    const config = store.loadConfig();
    if (config.schedule.enabled) {
      setTimeout(() => {
        syncSchedule(config).catch(() => {});
      }, 1500);
    }
  }

  return {
    store,
    getState,
    saveConfig,
    probe,
    steamLibrary,
    addSources,
    importText,
    updateSource,
    removeSource,
    testSource,
    setSecret,
    graphStart,
    graphPoll,
    run,
    getBriefing,
    openFolder,
    openPopup,
    testPopup,
    popupOptions,
    syncSchedule,
    scheduleAction,
    launcherFile,
    runCmdFile: () => runCmdPath(store.dir),
  };
}
