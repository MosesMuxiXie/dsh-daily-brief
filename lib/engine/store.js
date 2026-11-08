/**
 * Filesystem store shared by the Host plugin and the headless runner.
 *
 * Layout (under <DSH_HOME>/storages/daily-brief by default):
 *   config.json          briefing configuration (no secrets)
 *   secrets.json         DPAPI-wrapped values
 *   state.json           last run / last delivered date
 *   runtime.json         Electron executable + CLI paths captured by the Host
 *   run.cmd              generated launcher used by Task Scheduler
 *   headless-auth.yml    transient --patch overlay for the optional AI pass
 *   briefings/<date>/    data.json + index.html (+ email.html)
 *   logs/runner.log
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { mergeConfig } from './config.js';

export function resolveDshHome(env = process.env, home = os.homedir()) {
  const raw = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : '';
  if (raw === '') return path.join(home, '.dsh');
  const expanded = raw.replace(/^~(?=$|[\\/])/, home);
  return path.resolve(expanded);
}

export function resolveStoreDir(env = process.env, home = os.homedir()) {
  return path.join(resolveDshHome(env, home), 'storages', 'daily-brief');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJsonAtomic(file, value) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function dateKey(now = new Date(), timeZone = 'Asia/Shanghai') {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function localTime(now = new Date(), timeZone = 'Asia/Shanghai') {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now);
  } catch {
    return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }
}

export function createStore(storeDir = resolveStoreDir()) {
  const dir = path.resolve(storeDir);
  const briefingsDir = path.join(dir, 'briefings');
  const logsDir = path.join(dir, 'logs');
  ensureDir(dir);
  ensureDir(briefingsDir);
  ensureDir(logsDir);

  const store = {
    dir,
    briefingsDir,
    logsDir,
    configPath: path.join(dir, 'config.json'),
    secretsPath: path.join(dir, 'secrets.json'),
    statePath: path.join(dir, 'state.json'),
    runtimePath: path.join(dir, 'runtime.json'),
    logPath: path.join(logsDir, 'runner.log'),

    loadConfig() {
      return mergeConfig(readJson(store.configPath, null));
    },

    saveConfig(config) {
      const normalized = mergeConfig(config);
      writeJsonAtomic(store.configPath, normalized);
      return normalized;
    },

    loadState() {
      return readJson(store.statePath, {});
    },

    saveState(state) {
      writeJsonAtomic(store.statePath, state);
      return state;
    },

    updateState(patch) {
      return store.saveState({ ...store.loadState(), ...patch });
    },

    loadRuntime() {
      return readJson(store.runtimePath, null);
    },

    saveRuntime(runtime) {
      writeJsonAtomic(store.runtimePath, runtime);
      return runtime;
    },

    log(line) {
      const stamped = `[${new Date().toISOString()}] ${line}\n`;
      try {
        fs.appendFileSync(store.logPath, stamped, 'utf8');
      } catch {
        /* logging must never break a run */
      }
      process.stdout.write(stamped);
    },

    briefingDir(key) {
      return path.join(briefingsDir, key);
    },

    writeBriefing(key, data, html, emailHtml) {
      const target = store.briefingDir(key);
      ensureDir(target);
      writeJsonAtomic(path.join(target, 'data.json'), data);
      fs.writeFileSync(path.join(target, 'index.html'), html, 'utf8');
      if (emailHtml) fs.writeFileSync(path.join(target, 'email.html'), emailHtml, 'utf8');
      return target;
    },

    readBriefing(key) {
      const safe = /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : '';
      if (safe === '') return null;
      const target = store.briefingDir(safe);
      const data = readJson(path.join(target, 'data.json'), null);
      if (!data) return null;
      let html = '';
      try {
        html = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
      } catch {
        html = '';
      }
      return { data, html, dir: target };
    },

    listBriefings(limit = 40) {
      const rows = [];
      let entries = [];
      try {
        entries = fs.readdirSync(briefingsDir, { withFileTypes: true });
      } catch {
        return rows;
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
        const data = readJson(path.join(briefingsDir, entry.name, 'data.json'), null);
        if (!data) continue;
        rows.push({
          id: entry.name,
          generatedAt: data.generatedAt ?? '',
          headline: data.headline ?? '',
          greeting: data.greeting ?? '',
          sections: Array.isArray(data.sections) ? data.sections.length : 0,
          items: (data.sections ?? []).reduce((sum, section) => sum + (section.items?.length ?? 0), 0),
          status: data.status ?? 'ok',
        });
      }
      rows.sort((a, b) => (a.id < b.id ? 1 : -1));
      return rows.slice(0, limit);
    },

    prune(retentionDays = 30, now = new Date()) {
      const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
      const cutoffKey = cutoff.toISOString().slice(0, 10);
      let removed = 0;
      try {
        for (const entry of fs.readdirSync(briefingsDir, { withFileTypes: true })) {
          if (!entry.isDirectory() || !/^\d{4}-\d{2}-\d{2}$/.test(entry.name)) continue;
          if (entry.name < cutoffKey) {
            fs.rmSync(path.join(briefingsDir, entry.name), { recursive: true, force: true });
            removed += 1;
          }
        }
      } catch {
        /* pruning is best effort */
      }
      return removed;
    },
  };

  return store;
}
