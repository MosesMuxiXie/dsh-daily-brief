/**
 * Optional AI polish. Uses the packaged DSH CLI in one-shot headless mode so the
 * saved DeepSeek sign-in can be reused. Any failure is non-fatal.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { resolveDshHome } from './store.js';

const AUTH_OVERLAY = `# DSH Daily Brief: re-enable the managed credential store for this
# one-shot headless run, so the desktop sign-in can be reused.
- id: credentials
  disabled: false
- id: authorization
  disabled: false
- id: deepseek-account
  disabled: false
`;

export function ensureAuthOverlay(storeDir) {
  const file = path.join(storeDir, 'headless-auth.yml');
  fs.mkdirSync(storeDir, { recursive: true });
  fs.writeFileSync(file, AUTH_OVERLAY, 'utf8');
  return file;
}

export function resolveDesktopRuntime(env = process.env) {
  const exe =
    (env.DSH_DESKTOP_EXE && String(env.DSH_DESKTOP_EXE)) ||
    (process.versions.electron && /\.exe$/i.test(process.execPath) ? process.execPath : '') ||
    path.join(env.LOCALAPPDATA || env.USERPROFILE || '', 'Programs', 'DSH NEXT', 'DSH NEXT.exe');
  const resources = process.versions.electron && process.resourcesPath
    ? process.resourcesPath
    : path.join(path.dirname(exe), 'resources');
  const asar = path.join(resources, 'app.asar');
  const cli = path.join(asar, 'lib', 'desktop-cli.js');
  // 在普通 Node 下 fs 不识别 asar 内部路径，但 Electron 能读取；两种入口都算可用。
  return { exe, cli, resources, asar, available: fs.existsSync(exe) && (fs.existsSync(cli) || fs.existsSync(asar)) };
}

function buildPrompt(briefing, config) {
  const persona = briefing.persona;
  const lines = [
    '你是一份中文每日简报的编辑。请为下面的条目写一句话标题（不超过 22 字，不要以“早上好/晚上好”等问候开头），再写一句引言（不超过 70 字，补充一点整体感觉，不要罗列条目）。',
    `简报人格：${persona.name}。语气要求：${persona.prompt || personaTone(persona.id)}`,
    `当前时间：${briefing.dateLabel} ${briefing.timeLabel}。问候与用词必须和这个时间匹配（清晨/上午/下午/晚上），不要写成其他时段。`,
    '只输出一个 JSON 对象，不要代码块，不要其他文字。格式：',
    '{"headline":"标题","intro":"引言"}',
    '',
    `日期：${briefing.dateLabel}`,
  ];
  for (const section of briefing.sections) {
    lines.push(`\n【${section.zh}】${section.summary}`);
    for (const item of section.items.slice(0, 6)) {
      lines.push(`- ${item.title}${item.meta ? `（${item.meta}）` : ''}`);
    }
  }
  lines.push('', '不要编造数据中没有的事实；引言可以留空。');
  return lines.join('\n').slice(0, 12000);
}

function personaTone(id) {
  return (
    {
      whale: '温柔、轻快，像一只慢悠悠的蓝鲸，偶尔用“呀”“呢”收尾。',
      assistant: '清楚、可靠，先给结论再补一句背景，句子短。',
      butler: '正式、周到，称呼“您”，像管家汇报。',
      officer: '简短、果断，像作战简报，不用感叹号。',
      custom: '自然、像一位熟悉你的朋友。',
    }[id] ?? '自然、清楚。'
  );
}

function parseReply(stdout) {
  const text = String(stdout || '');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.headline !== 'string' && typeof parsed.intro !== 'string' && !parsed.sections) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function polishBriefing(briefing, config, storeDir) {
  const ai = config.ai ?? {};
  if (ai.polish === 'off') return { ok: false, skipped: true, error: 'disabled' };
  const runtime = resolveDesktopRuntime();
  if (!runtime.available) return { ok: false, error: '找不到 DSH Desktop 可执行文件' };
  const overlay = ensureAuthOverlay(storeDir);
  const prompt = buildPrompt(briefing, config);
  const args = ['--expose-internals', runtime.cli, '--profile', 'headless', '--patch', overlay];
  const timeoutMs = Math.max(30, Number(ai.timeoutSec) || 120) * 1000;

  return new Promise((resolve) => {
    const child = spawn(runtime.exe, args, {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: process.env.DSH_HOME || resolveDshHome() },
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({ ok: false, error: `AI 润色超时（${Math.round(timeoutMs / 1000)} 秒）` });
    }, timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 65536) stderr = stderr.slice(-65536);
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      finish({ ok: false, error: error.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        finish({ ok: false, error: (stderr || `headless exit ${code}`).slice(-800) });
        return;
      }
      const parsed = parseReply(stdout);
      if (!parsed) {
        finish({ ok: false, error: 'AI 返回格式无法解析' });
        return;
      }
      finish({ ok: true, data: parsed, note: '由 AI 润色' });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt, 'utf8');
  });
}
