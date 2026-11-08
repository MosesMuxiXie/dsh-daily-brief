/**
 * Read-only discovery of the local Steam library.
 *
 * Steam keeps its install roots in the registry and, since 2019, in
 * `steamapps/libraryfolders.vdf`. Every installed app has an
 * `appmanifest_<appid>.acf` file with its name, state flags and last-played
 * time. Nothing is written back, and no Steam process is required.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CACHE_MS = 5 * 60 * 1000;
let cache = { at: 0, value: null };

function registrySteamPath() {
  const queries = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ];
  for (const [key, name] of queries) {
    try {
      const out = execFileSync('reg', ['query', key, '/v', name], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
      });
      const match = out.match(/REG_SZ\s+([^\r\n]+)/i) || out.match(/REG_EXPAND_SZ\s+([^\r\n]+)/i);
      if (match) return match[1].trim();
    } catch {
      // try the next location
    }
  }
  return '';
}

function candidateRoots() {
  const roots = [];
  const fromRegistry = registrySteamPath();
  if (fromRegistry) roots.push(fromRegistry);
  for (const envKey of ['ProgramFiles(x86)', 'ProgramFiles']) {
    const base = process.env[envKey];
    if (base) roots.push(path.join(base, 'Steam'));
  }
  return [...new Set(roots.map((root) => path.win32.normalize(root)).filter(Boolean))];
}

function parseVdfPaths(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    const paths = [];
    const re = /"path"\s*"((?:[^"\\]|\\.)*)"/gi;
    let match;
    while ((match = re.exec(text)) !== null) {
      paths.push(match[1].replace(/\\\\/g, '\\'));
    }
    return paths;
  } catch {
    return [];
  }
}

function readManifest(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const grab = (key) => {
    const match = text.match(new RegExp(`"${key}"\\s*"([^"]*)"`, 'i'));
    return match ? match[1] : '';
  };
  const appid = Number(grab('appid')) || 0;
  const name = grab('name').trim();
  if (!appid || !name) return null;
  const stateFlags = Number(grab('StateFlags')) || 0;
  const installed = (stateFlags & 4) !== 0 || stateFlags === 0;
  if (!installed) return null;
  if (/^(steamworks|proton|steam linux runtime|steamvr|steam client|wallpaper engine)/i.test(name)) return null;
  const lastPlayed = Number(grab('LastPlayed')) || Number(grab('lastplayed')) || 0;
  return { appid, name, lastPlayed };
}

export function discoverSteamLibrary({ force = false } = {}) {
  if (!force && cache.value && Date.now() - cache.at < CACHE_MS) return cache.value;
  const roots = candidateRoots();
  const steamapps = new Set();
  let steamRoot = '';
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    steamRoot = steamRoot || root;
    const manifestDir = path.join(root, 'steamapps');
    if (fs.existsSync(manifestDir)) steamapps.add(manifestDir);
    for (const file of ['libraryfolders.vdf', path.join('config', 'libraryfolders.vdf')]) {
      for (const library of parseVdfPaths(path.join(root, file))) {
        const dir = path.join(library, 'steamapps');
        if (fs.existsSync(dir)) steamapps.add(dir);
      }
    }
  }

  const games = [];
  const seen = new Set();
  for (const dir of steamapps) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!/^appmanifest_\d+\.acf$/i.test(entry)) continue;
      const manifest = readManifest(path.join(dir, entry));
      if (!manifest || seen.has(manifest.appid)) continue;
      seen.add(manifest.appid);
      games.push(manifest);
    }
  }
  games.sort((left, right) => right.lastPlayed - left.lastPlayed || left.name.localeCompare(right.name));
  const value = {
    ok: steamRoot !== '',
    root: steamRoot,
    libraries: [...steamapps],
    games: games.slice(0, 200),
  };
  cache = { at: Date.now(), value };
  return value;
}

export function steamLibrarySummary(options) {
  const library = discoverSteamLibrary(options);
  return {
    ok: library.ok,
    root: library.root,
    count: library.games.length,
    games: library.games.map((game) => ({
      appid: game.appid,
      name: game.name,
      lastPlayed: game.lastPlayed > 0 ? new Date(game.lastPlayed * 1000).toISOString() : '',
    })),
  };
}
