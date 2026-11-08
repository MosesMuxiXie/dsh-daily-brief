import fs from 'node:fs';
import path from 'node:path';

/**
 * A tiny pid-less file lock. Scheduled runs and manual runs must not overlap.
 */
export function acquireLock(storeDir, options = {}) {
  const staleMs = options.staleMs ?? 45 * 60 * 1000;
  const file = path.join(storeDir, 'run.lock');
  fs.mkdirSync(storeDir, { recursive: true });

  try {
    const stat = fs.statSync(file);
    if (Date.now() - stat.mtimeMs > staleMs) {
      fs.rmSync(file, { force: true });
    }
  } catch {
    // no existing lock
  }

  try {
    const payload = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
    const fd = fs.openSync(file, 'wx');
    fs.writeFileSync(fd, payload, 'utf8');
    fs.closeSync(fd);
  } catch (error) {
    if (error.code === 'EEXIST') {
      let holder = '';
      try {
        holder = fs.readFileSync(file, 'utf8');
      } catch {
        // ignore
      }
      return { ok: false, holder };
    }
    throw error;
  }

  let released = false;
  return {
    ok: true,
    file,
    release() {
      if (released) return;
      released = true;
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // ignore
      }
    },
  };
}
