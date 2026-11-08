/**
 * Windows shell helpers.
 *
 * v2 no longer raises system toasts: the briefing is shown as its own desktop
 * window (see popup.js). This module only keeps the "open a file with the
 * default handler" fallback.
 */
import { spawn } from 'node:child_process';

export async function openBriefingFile(file, options = {}) {
  if (process.platform !== 'win32') return { ok: false, error: 'not windows' };
  return new Promise((resolve) => {
    try {
      const child = spawn('cmd.exe', ['/c', 'start', '', file], {
        windowsHide: true,
        detached: true,
        stdio: 'ignore',
        ...options,
      });
      child.on('error', (error) => resolve({ ok: false, error: error.message }));
      child.unref();
      resolve({ ok: true });
    } catch (error) {
      resolve({ ok: false, error: error.message });
    }
  });
}
