/**
 * Windows Task Scheduler integration. The task runs run.cmd, which starts the
 * packaged Electron binary in Node mode so the briefing is generated even when
 * the DSH window is closed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { runProcess } from './ps.js';
import { resolveDshHome } from '../engine/store.js';

export const TASK_NAME = 'DSH Daily Brief';

export function runCmdPath(storeDir) {
  return path.join(storeDir, 'run.cmd');
}

export function runPs1Path(storeDir) {
  return path.join(storeDir, 'run.ps1');
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Prefer the Node shipped with DSH (or the running Node); Electron-as-Node is the last resort. */
export function resolveNodeExe(env = process.env) {
  const home = env.DSH_HOME || resolveDshHome(env);
  const candidates = [
    env.DSH_NODE_EXE,
    path.join(home, 'dsh-runtimes', 'dsh-next-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    path.join(home, 'dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'node', 'bin', 'node.exe'),
    !process.versions.electron ? process.execPath : '',
  ];
  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) return candidate;
  }
  return 'node';
}

export function writeRunCmd({ storeDir, exe, runnerPath, env = process.env }) {
  const home = env.DSH_HOME || resolveDshHome(env);
  const nodeExe = resolveNodeExe(env);
  const taskLog = path.join(storeDir, 'logs', 'task.log');
  fs.mkdirSync(storeDir, { recursive: true });
  // 批处理文件以 UTF-8 保存时，cmd.exe 在中文路径上仍会按 ANSI 解析，
  // 因此真正的启动逻辑放在 PowerShell 脚本里（UTF-8 BOM），run.cmd 只做 ASCII 转发。
  // 使用普通 Node 执行引擎；Electron 的 GUI 子系统会让等待/退出行为不可靠。
  const ps1 = [
    "$ErrorActionPreference = 'Continue'",
    '$env:ELECTRON_RUN_AS_NODE = $null',
    `$env:DSH_HOME = ${psQuote(home)}`,
    `$env:DSH_DESKTOP_EXE = ${psQuote(exe)}`,
    `& ${psQuote(nodeExe)} ${psQuote(runnerPath)} --store ${psQuote(storeDir)} --trigger schedule *>> ${psQuote(taskLog)}`,
    'exit $LASTEXITCODE',
    '',
  ].join('\r\n');
  fs.writeFileSync(runPs1Path(storeDir), '\uFEFF' + ps1, 'utf8');

  const cmd = [
    '@echo off',
    'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0run.ps1"',
    'exit /b %ERRORLEVEL%',
    '',
  ].join('\r\n');
  fs.writeFileSync(runCmdPath(storeDir), cmd, 'ascii');
  return runCmdPath(storeDir);
}

function psString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export async function installTask({ storeDir, time, wakeToRun = false, exe, runnerPath }) {
  if (!/^\d{2}:\d{2}$/.test(time)) throw new Error(`无效的时间：${time}`);
  const cmdFile = writeRunCmd({ storeDir, exe, runnerPath });
  const script = `
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + $env:DB_TASK_CMD + '"')
$trigger = New-ScheduledTaskTrigger -Daily -At $env:DB_TASK_TIME
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -RestartInterval (New-TimeSpan -Minutes 10) -RestartCount 2
if ($env:DB_TASK_WAKE -eq '1') { $settings.WakeToRun = $true }
Register-ScheduledTask -TaskName $env:DB_TASK_NAME -Action $action -Trigger $trigger -Settings $settings -Description 'DSH 每日简报：定时生成并弹出通知' -Force | Out-Null
`;
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeoutMs: 30000,
    env: { DB_TASK_CMD: cmdFile, DB_TASK_TIME: time, DB_TASK_NAME: TASK_NAME, DB_TASK_WAKE: wakeToRun ? '1' : '0' },
  });
  if (!result.ok) throw new Error((result.stderr || result.stdout || '注册计划任务失败').slice(0, 800));
  return queryTask();
}

export async function queryTask() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$task = Get-ScheduledTask -TaskName $env:DB_TASK_NAME
if ($null -eq $task) { '{"installed":false}'; exit 0 }
$info = Get-ScheduledTaskInfo -TaskName $env:DB_TASK_NAME
[pscustomobject]@{
  installed = $true
  state = [string]$task.State
  nextRunTime = if ($info.NextRunTime) { $info.NextRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
  lastRunTime = if ($info.LastRunTime) { $info.LastRunTime.ToString('yyyy-MM-dd HH:mm:ss') } else { '' }
  lastTaskResult = [int64]$info.LastTaskResult
} | ConvertTo-Json -Compress
`;
  const result = await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeoutMs: 20000,
    env: { DB_TASK_NAME: TASK_NAME },
  });
  if (!result.ok) return { installed: false, error: (result.stderr || result.stdout || '').slice(0, 400) };
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).pop() || '{}';
  try {
    return JSON.parse(line);
  } catch {
    return { installed: false, error: line.slice(0, 400) };
  }
}

export async function removeTask() {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
Unregister-ScheduledTask -TaskName $env:DB_TASK_NAME -Confirm:$false
`;
  await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeoutMs: 20000,
    env: { DB_TASK_NAME: TASK_NAME },
  });
  return queryTask();
}

export async function runTaskNow() {
  const script = `Start-ScheduledTask -TaskName $env:DB_TASK_NAME`;
  return runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeoutMs: 20000,
    env: { DB_TASK_NAME: TASK_NAME },
  });
}
