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
    '你是一份中文每日简报的编辑。请输出三部分：',
    '1) 一句话标题（不超过 22 字，不要以“早上好/晚上好”等问候开头）；',
    '2) 一句引言（不超过 70 字，补充整体感觉，不要罗列条目）；',
    '3) 两份要点清单：aiNews（新闻）与 gameNews（游戏）按当天条目逐条输出，有多少条就写多少条（不设上限，不要合并、不要截断），每条 12–46 字，一句一个要点，点出“谁做了什么/有什么变化”，可以提公司、产品或模型名字；不要出现网址、链接、“点击查看”等字样，不要编造数据里没有的事实，不要写成散文段落。',
    `简报人格：${persona.name}。语气要求：${persona.prompt || personaTone(persona.id)}`,
    '每一条要点都要用这个角色的口吻说话（称呼、自称、口癖、态度），像角色本人在跟用户聊天，不要写成中性新闻摘要；同一句里不要堆口头禅，也不要在每条前面重复称呼。',
    `当前时间：${briefing.dateLabel} ${briefing.timeLabel}。问候与用词必须和这个时间匹配（清晨/上午/下午/晚上），不要写成其他时段。`,
    '只输出一个 JSON 对象，不要代码块，不要其他文字。格式：',
    '{"headline":"标题","intro":"引言","points":{"aiNews":["要点一","要点二"],"gameNews":["要点一","要点二"]}}',
    '',
    `日期：${briefing.dateLabel}`,
  ];
  for (const section of briefing.sections) {
    lines.push(`\n【${section.zh}】共 ${section.items.length} 条`);
    for (const item of section.items) {
      const detail = String(item.detail || '').replace(/\s+/g, ' ').trim().slice(0, 110);
      lines.push(`- ${item.title}${item.meta ? `（${item.meta}）` : ''}${detail ? `：${detail}` : ''}`);
    }
  }
  lines.push('', 'points 只写 aiNews 与 gameNews 两个键，值是字符串数组；没有内容的板块给空数组。');
  return lines.join('\n').slice(0, 12000);
}

function personaTone(id) {
  return (
    {
      whale: '温柔、轻快，自称「本鲸」、称用户「主人」，偶尔用「呀」「呢」收尾；例：本鲸瞅了眼 OpenAI，图像生成那边翻了车呀。',
      assistant: '清楚、可靠，先给结论再补一句背景，句子短；例：OpenAI 图像生成报错，官方已发文说明。',
      butler: '正式、周到，称呼「您」，像管家汇报；例：先生，游戏那边有两场活动，您得空可以看看。',
      officer: '简短、果断，动词开头，不用感叹号；例：坦克世界闪击战双活动上线，含 K-70 联队事件。',
      custom: '自然、像一位熟悉你的朋友；例：今天新闻这边有点热闹，我给你挑了几条。',
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
    if (typeof parsed.headline !== 'string' && typeof parsed.intro !== 'string' && !parsed.sections && !parsed.points && !parsed.digests) return null;
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
