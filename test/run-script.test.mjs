import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeRunCmd, runPs1Path } from '../lib/host/schedule-task.js';

test('the generated runner script probes Clash before enabling a proxy', () => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-runcmd-'));
  try {
    writeRunCmd({
      storeDir,
      exe: 'C:\\Apps\\DSH NEXT.exe',
      runnerPath: 'C:\\plugin\\lib\\engine\\runner.js',
    });
    const script = fs.readFileSync(runPs1Path(storeDir), 'utf8');
    assert.match(script, /7897/);
    assert.match(script, /NODE_USE_ENV_PROXY/);
    assert.match(script, /--trigger schedule/);
  } finally {
    fs.rmSync(storeDir, { recursive: true, force: true });
  }
});
