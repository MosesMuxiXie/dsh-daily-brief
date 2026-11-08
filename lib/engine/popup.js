/**
 * Show a briefing as a real desktop window, the way Notepad appears: a small
 * always-separate app window, not a system notification.
 *
 * Chromium (Edge first, then Chrome) is launched in `--app=` mode with its own
 * profile directory, so no tabs, no toolbar and no sign-in state. The window is
 * placed in the bottom-right corner of the primary work area. When no Chromium
 * is present we fall back to the user's default browser.
 */
import { spawn, execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openBriefingFile } from './notify.js';

const MARGIN = 18;

function firstExisting(candidates) {
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function findChromium() {
  const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env['LOCALAPPDATA'] || '';
  return firstExisting([
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    localAppData ? path.join(localAppData, 'Microsoft', 'Edge', 'Application', 'msedge.exe') : '',
    localAppData ? path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe') : '',
  ]);
}

function workArea() {
  return new Promise((resolve) => {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms;',
      '$a=[System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea;',
      '[string]$a.X + "," + [string]$a.Y + "," + [string]$a.Width + "," + [string]$a.Height',
    ].join(' ');
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 6000, windowsHide: true },
      (error, stdout) => {
        if (error) return resolve({ x: 0, y: 0, width: 1920, height: 1040 });
        const parts = String(stdout).trim().split(',').map((value) => Number(value));
        if (parts.length !== 4 || parts.some((value) => !Number.isFinite(value))) {
          return resolve({ x: 0, y: 0, width: 1920, height: 1040 });
        }
        resolve({ x: parts[0], y: parts[1], width: parts[2], height: parts[3] });
      },
    );
  });
}

function place(area, width, height, position) {
  const maxX = area.x + area.width - width - MARGIN;
  const maxY = area.y + area.height - height - MARGIN;
  if (position === 'center') {
    return {
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
    };
  }
  if (position === 'top-right') {
    return { x: Math.max(area.x + MARGIN, maxX), y: area.y + MARGIN };
  }
  return { x: Math.max(area.x + MARGIN, maxX), y: Math.max(area.y + MARGIN, maxY) };
}

/**
 * @returns {Promise<{ok:boolean, mode:'app'|'browser', browser?:string, pid?:number, message?:string}>}
 */
export async function openBriefingWindow(file, options = {}) {
  const width = Math.max(360, Number(options.width) || 560);
  const height = Math.max(480, Number(options.height) || 860);
  const browser = findChromium();
  const target = pathToFileURL(file).href;

  if (!browser) {
    const opened = openBriefingFile(file);
    return { ok: Boolean(opened?.ok ?? opened), mode: 'browser', message: '没有找到 Edge 或 Chrome，已用默认浏览器打开' };
  }

  const area = await workArea();
  const spot = place(area, width, height, options.position);
  const profileDir = options.profileDir || path.join(path.dirname(file), '..', '.popup-profile');
  const args = [
    `--app=${target}`,
    `--window-size=${width},${height}`,
    `--window-position=${spot.x},${spot.y}`,
    `--user-data-dir=${path.resolve(profileDir)}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--lang=zh-CN',
    '--disable-translate',
    '--disable-features=Translate,TranslateUI,MediaRouter',
    '--disable-session-crashed-bubble',
    '--hide-crash-restore-bubble',
    '--disable-sync',
  ];

  return new Promise((resolve) => {
    try {
      const child = spawn(browser, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.once('error', (error) => {
        const opened = openBriefingFile(file);
        resolve({
          ok: Boolean(opened?.ok ?? opened),
          mode: 'browser',
          message: `独立窗口启动失败（${error.message}），已用默认浏览器打开`,
        });
      });
      child.once('spawn', () => {
        child.unref();
        resolve({ ok: true, mode: 'app', browser, pid: child.pid });
      });
    } catch (error) {
      const opened = openBriefingFile(file);
      resolve({ ok: Boolean(opened?.ok ?? opened), mode: 'browser', message: String(error?.message || error) });
    }
  });
}
