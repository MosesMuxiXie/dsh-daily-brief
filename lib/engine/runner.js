#!/usr/bin/env node
/**
 * Headless runner. Windows Task Scheduler starts it as
 *   DSH NEXT.exe runner.js --store <dir> --trigger schedule
 * with ELECTRON_RUN_AS_NODE=1, but it also runs under plain node.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createStore, resolveStoreDir, dateKey } from './store.js';
import { collectSource } from './collect/index.js';
import { buildBriefing, applyAiPolish } from './render/model.js';
import { renderBriefingHtml } from './render/html.js';
import { renderBriefingEmail } from './render/email.js';
import { acquireLock } from './lock.js';
import { openBriefingFile } from './notify.js';
import { openBriefingWindow } from './popup.js';
import { polishBriefing } from './ai.js';
import { readSecret } from './secrets.js';

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function sendEmail(config, store, briefing, emailContent) {
  const settings = config.delivery.email;
  if (!settings.host) return { ok: false, error: '未配置 SMTP 服务器' };
  if (!settings.to) return { ok: false, error: '未配置收件地址' };
  let nodemailer;
  try {
    nodemailer = await import('nodemailer');
  } catch {
    return { ok: false, error: 'nodemailer 不可用' };
  }
  const password = await readSecret(store.dir, 'smtp:password');
  if (!password) return { ok: false, error: '未保存 SMTP 密码' };
  try {
    const transport = nodemailer.default.createTransport({
      host: settings.host,
      port: settings.port,
      secure: settings.secure,
      auth: { user: settings.user || settings.from, pass: password },
    });
    await transport.sendMail({
      from: settings.from || settings.user,
      to: settings.to,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 400) };
  }
}

async function sendWebhook(config, briefing) {
  const settings = config.delivery.webhook;
  if (!settings.url) return { ok: false, error: '未配置 webhook 地址' };
  let url = settings.url;
  const lines = [briefing.greeting, briefing.headline, ''];
  for (const section of briefing.sections) {
    lines.push(`【${section.zh}】${section.summary}`);
    for (const item of section.items.slice(0, 3)) lines.push(`· ${item.title}`);
  }
  const text = lines.join('\n').slice(0, 1800);
  try {
    if (settings.kind === 'ntfy') {
      if (settings.topic && !url.includes(settings.topic)) url = `${url.replace(/\/$/, '')}/${settings.topic}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { Title: encodeURIComponent(`每日简报 · ${briefing.dateLabel}`), Tags: 'newspaper' },
        body: text,
        signal: AbortSignal.timeout(15000),
      });
      return { ok: response.ok, status: response.status };
    }
    if (settings.kind === 'telegram') {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: settings.topic, text, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(15000),
      });
      return { ok: response.ok, status: response.status };
    }
    if (settings.kind === 'bark') {
      const response = await fetch(`${url.replace(/\/$/, '')}/${encodeURIComponent(briefing.headline)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `每日简报 · ${briefing.dateLabel}`, body: text }),
        signal: AbortSignal.timeout(15000),
      });
      return { ok: response.ok, status: response.status };
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: `每日简报 · ${briefing.dateLabel}`,
        text,
        date: briefing.dateKey,
        headline: briefing.headline,
      }),
      signal: AbortSignal.timeout(15000),
    });
    return { ok: response.ok, status: response.status };
  } catch (error) {
    return { ok: false, error: String(error.message || error).slice(0, 400) };
  }
}

export async function runBriefing(options = {}) {
  const storeDir = options.store ? path.resolve(options.store) : resolveStoreDir();
  const store = createStore(storeDir);
  const config = store.loadConfig();
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`无效的 --now 时间：${options.now}`);
  const key = options.dateKey || dateKey(now, config.timezone);
  const dryRun = Boolean(options.dryRun);
  const deliver = options.deliver !== false && !dryRun;
  const force = Boolean(options.force);
  const trigger = options.trigger || 'manual';

  const state = store.loadState();
  if (!force && !dryRun && state.lastRunDate === key) {
    store.log(`skip: ${key} 已生成（manual --force 可重跑）`);
    return { ok: true, skipped: true, reason: 'already-ran', dateKey: key };
  }

  const lock = acquireLock(store.dir);
  if (!lock.ok) {
    store.log(`skip: 另一个运行正在进行（${lock.holder || 'lock held'}）`);
    return { ok: true, skipped: true, reason: 'locked', dateKey: key };
  }

  const startedAt = Date.now();
  store.log(`run start · ${key} · trigger=${trigger}${dryRun ? ' · dry-run' : ''}`);
  try {
    const sources = config.sources.filter((source) => source.enabled !== false);
    const results = await mapLimit(sources, 4, async (source) => {
      const result = await collectSource(source, { storeDir: store.dir, config, now });
      store.log(`  ${source.label}: ${result.status} · ${result.items.length} 条${result.note ? ` · ${result.note}` : ''}`);
      return { source, result };
    });

    let briefing = buildBriefing({ config, results, dateKey: key, now });
    let aiError = '';
    if (!dryRun && config.ai.polish !== 'off' && briefing.sections.length > 0) {
      const polished = await polishBriefing(briefing, config, store.dir);
      if (polished.ok) {
        briefing = applyAiPolish(briefing, { ...polished.data, note: polished.note || '由 AI 润色' });
        store.log('  AI 润色完成');
      } else {
        aiError = polished.skipped ? '' : polished.error;
        if (aiError) store.log(`  AI 润色跳过：${aiError}`);
      }
    }

    const html = renderBriefingHtml(briefing);
    const emailContent = renderBriefingEmail(briefing);
    if (dryRun) {
      store.log(`dry-run: ${briefing.sections.length} 个板块 / ${briefing.stats.items} 条更新`);
      return { ok: true, dryRun: true, dateKey: key, briefing, html, email: emailContent, elapsedMs: Date.now() - startedAt };
    }

    const target = store.writeBriefing(key, { ...briefing, status: briefing.warnings.length > 0 ? 'partial' : 'ok' }, html, emailContent.html);
    const delivered = { popup: null, email: null, webhook: null, opened: false };
    const popup = config.delivery.popup || {};

    if (deliver && popup.enabled !== false && popup.openOnGenerate !== false) {
      delivered.popup = await openBriefingWindow(path.join(target, 'index.html'), {
        width: popup.width,
        height: popup.height,
        position: popup.position,
        profileDir: path.join(store.dir, '.popup-profile'),
      });
      if (!delivered.popup.ok) store.log(`  弹窗失败：${delivered.popup.message || 'unknown'}`);
    }
    if (config.delivery.openBriefing) {
      const opened = await openBriefingFile(path.join(target, 'index.html'));
      delivered.opened = Boolean(opened.ok);
    }
    if (config.delivery.email.enabled && deliver) {
      delivered.email = await sendEmail(config, store, briefing, emailContent);
      if (!delivered.email.ok) store.log(`  邮件失败：${delivered.email.error}`);
    }
    if (config.delivery.webhook.enabled && deliver) {
      delivered.webhook = await sendWebhook(config, briefing);
      if (!delivered.webhook.ok) store.log(`  webhook 失败：${delivered.webhook.error || delivered.webhook.status}`);
    }

    const at = new Date().toISOString();
    store.updateState({
      lastRunDate: key,
      lastRunAt: at,
      lastStatus: briefing.warnings.length > 0 ? 'partial' : 'ok',
      lastItems: briefing.stats.items,
      lastIssues: briefing.warnings.length,
      lastTrigger: trigger,
      lastDelayMs: Date.now() - startedAt,
      lastError: '',
    });
    store.saveRuntime({
      ...(store.loadRuntime() || {}),
      lastDelivery: delivered,
      lastAiError: aiError,
      lastRunAt: at,
      lastTarget: target,
    });
    store.prune(config.retentionDays, now);
    store.log(`run done · ${briefing.stats.items} 条 · ${Date.now() - startedAt}ms`);
    return { ok: true, dateKey: key, target, briefing, delivery: delivered, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    store.log(`run failed: ${error.stack || error.message || error}`);
    store.updateState({ lastError: String(error.message || error).slice(0, 800), lastRunAt: new Date().toISOString() });
    return { ok: false, error: String(error.message || error) };
  } finally {
    lock.release();
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--store') options.store = argv[++i];
    else if (arg === '--now') options.now = argv[++i];
    else if (arg === '--date') options.dateKey = argv[++i];
    else if (arg === '--trigger') options.trigger = argv[++i];
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--no-deliver') options.deliver = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
  }
  return options;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: runner.js [--store DIR] [--now ISO] [--date YYYY-MM-DD] [--trigger NAME] [--dry-run] [--no-deliver] [--force]\n');
    process.exit(0);
  }
  runBriefing(options)
    .then((result) => {
      if (result.dryRun) process.stdout.write(`${result.email.text}\n`);
      process.exit(result.ok ? 0 : 1);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message || error}\n`);
      process.exit(1);
    });
}
