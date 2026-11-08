/**
 * Secret storage for the daily brief.
 *
 * Values are encrypted with Windows DPAPI (CurrentUser) through PowerShell, so
 * the on-disk file is only readable by the signed-in Windows user. The Host and
 * the headless runner share this module; each process keeps a small in-memory
 * cache so polling the panel does not spawn PowerShell for every read.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { readJson, writeJsonAtomic } from './store.js';

const execFileAsync = promisify(execFile);

const PROTECT_SCRIPT = [
  '$bytes = [Text.Encoding]::UTF8.GetBytes($env:DSH_DB_SECRET)',
  "$cipher = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser')",
  '[Convert]::ToBase64String($cipher)',
].join('; ');

const UNPROTECT_SCRIPT = [
  '$cipher = [Convert]::FromBase64String($env:DSH_DB_CIPHER)',
  "$bytes = [Security.Cryptography.ProtectedData]::Unprotect($cipher, $null, 'CurrentUser')",
  '[Text.Encoding]::UTF8.GetString($bytes)',
].join('; ');

const cache = new Map();

async function runPowerShell(script, extraEnv) {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    {
      env: { ...process.env, ...extraEnv },
      windowsHide: true,
      timeout: 20000,
      maxBuffer: 1024 * 1024,
    },
  );
  return stdout.trim();
}

export async function protectSecret(plain) {
  return runPowerShell(PROTECT_SCRIPT, { DSH_DB_SECRET: String(plain) });
}

export async function unprotectSecret(cipher) {
  return runPowerShell(UNPROTECT_SCRIPT, { DSH_DB_CIPHER: String(cipher) });
}

function loadFile(storeDir) {
  const file = path.join(storeDir, 'secrets.json');
  const raw = readJson(file, null);
  if (!raw || typeof raw !== 'object' || raw.version !== 1 || typeof raw.items !== 'object') {
    return { file, data: { version: 1, items: {} } };
  }
  return { file, data: raw };
}

export function listSecretKeys(storeDir) {
  return Object.keys(loadFile(storeDir).data.items ?? {});
}

export async function readSecret(storeDir, key) {
  const { data } = loadFile(storeDir);
  const cipher = data.items?.[key];
  if (typeof cipher !== 'string' || cipher === '') return null;
  const cacheKey = `${storeDir}::${key}::${cipher.slice(-16)}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const value = await unprotectSecret(cipher);
  cache.set(cacheKey, value);
  return value;
}

export async function writeSecret(storeDir, key, value) {
  const { file, data } = loadFile(storeDir);
  if (value === null || value === undefined || value === '') {
    delete data.items[key];
  } else {
    data.items[key] = await protectSecret(value);
  }
  writeJsonAtomic(file, data);
  for (const cacheKey of cache.keys()) {
    if (cacheKey.startsWith(`${storeDir}::${key}::`)) cache.delete(cacheKey);
  }
}

export async function deleteSecret(storeDir, key) {
  await writeSecret(storeDir, key, '');
}

export function sourceSecretKey(sourceId, field) {
  return `src:${sourceId}:${field}`;
}

/** Delete every secret owned by a source id. */
export async function deleteSourceSecrets(storeDir, sourceId) {
  const keys = listSecretKeys(storeDir).filter((key) => key.startsWith(`src:${sourceId}:`));
  for (const key of keys) await deleteSecret(storeDir, key);
}

export async function readSourceSecret(storeDir, sourceId, field) {
  return readSecret(storeDir, sourceSecretKey(sourceId, field));
}

export async function writeSourceSecret(storeDir, sourceId, field, value) {
  return writeSecret(storeDir, sourceSecretKey(sourceId, field), value);
}

/** Custom request headers are stored as one JSON secret per source. */
export async function readSourceHeaders(storeDir, sourceId) {
  const raw = await readSourceSecret(storeDir, sourceId, 'headers');
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeSourceHeaders(storeDir, sourceId, headers) {
  const clean = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof name === 'string' && name.trim() !== '' && typeof value === 'string') {
      clean[name.trim().slice(0, 80)] = value.slice(0, 2000);
    }
  }
  const json = Object.keys(clean).length === 0 ? '' : JSON.stringify(clean);
  return writeSourceSecret(storeDir, sourceId, 'headers', json);
}

/** True when the file exists but DPAPI is unavailable (non-Windows CI). */
export function secretsSupported() {
  return process.platform === 'win32';
}

export function fileExists(file) {
  try {
    fs.accessSync(file);
    return true;
  } catch {
    return false;
  }
}
