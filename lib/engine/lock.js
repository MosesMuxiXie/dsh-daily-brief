import fs from 'node:fs';
import path from 'node:path';

function readHolder(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user; anything
    // else (typically ESRCH) means the pid is gone.
    return error?.code === 'EPERM';
  }
}

/**
 * A tiny pid lock. Scheduled runs and manual runs must not overlap, and a lock
 * left behind by a killed process is reclaimed immediately instead of making
 * the next scheduled run skip for up to 45 minutes.
 */
export function acquireLock(storeDir, options = {}) {
  const staleMs = options.staleMs ?? 45 * 60 * 1000;
  const file = path.join(storeDir, 'run.lock');
  fs.mkdirSync(storeDir, { recursive: true });

  try {
    const stat = fs.statSync(file);
    const holder = readHolder(file);
    const stale = Date.now() - stat.mtimeMs > staleMs;
    const dead = Number.isInteger(holder?.pid) && !pidAlive(holder.pid);
    if (stale || dead) fs.rmSync(file, { force: true });
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
