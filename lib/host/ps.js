import { spawn } from 'node:child_process';

/** Run a Windows helper process and capture bounded output. */
export function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(command, args, {
        windowsHide: true,
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
      });
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: error.message });
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 1_000_000) stdout = stdout.slice(-1_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 1_000_000) stderr = stderr.slice(-1_000_000);
    });
    child.on('error', (error) => finish({ ok: false, code: -1, stdout, stderr: error.message }));
    child.on('close', (code) => finish({ ok: code === 0, code, stdout, stderr }));
    if (options.timeoutMs) {
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // ignore
        }
      }, options.timeoutMs);
    }
  });
}
