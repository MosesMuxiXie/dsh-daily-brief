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
import { resolveSchedulePhase, PUBLISH_TOLERANCE_MS } from './schedule.js';

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

const PUBLISH_EARLY_MS = PUBLISH_TOLERANCE_MS;

async function generateBriefing({ store, config, now, key, dryRun }) {
  const startedAt = Date.now();
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
      if (aiError) {
        store.log(`  AI 润色跳过：${aiError}`);
        // Surface the reason in the brief itself: otherwise the only trace of a
        // skipped polish is this log line, which nobody reads at 8am.
        const reason = String(aiError).replace(/\s+/g, ' ').trim().slice(0, 160);
        briefing.warnings.push(`AI 润色未生效：${reason}`);
      }
    }
  }

  const html = renderBriefingHtml(briefing);
  const emailContent = renderBriefingEmail(briefing);
  const elapsedMs = Date.now() - startedAt;
  if (dryRun) {
    store.log(`dry-run: ${briefing.sections.length} 个板块 / ${briefing.stats.items} 条更新`);
    return { briefing, html, emailContent, aiError, elapsedMs, target: store.briefingDir(key) };
  }

  const target = store.writeBriefing(key, { ...briefing, status: briefing.warnings.length > 0 ? 'partial' : 'ok' }, html, emailContent.html);
  return { briefing, html, emailContent, aiError, elapsedMs, target };
}

async function deliverBriefing({ store, config, briefing, emailContent, target, deliver }) {
  const startedAt = Date.now();
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
  if (deliver && config.delivery.openBriefing) {
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
  return { delivered, elapsedMs: Date.now() - startedAt };
}

function recordPrepared({ store, key, briefing, elapsedMs }) {
  const items = briefing?.stats?.items ?? 0;
  store.updateState({
    lastPrepareDate: key,
    lastPrepareAt: new Date().toISOString(),
    lastPrepareStatus: briefing.warnings.length > 0 ? 'partial' : 'ok',
    lastPrepareItems: items,
    lastPrepareMs: elapsedMs,
    lastPrepareError: '',
  });
}

function recordPublished({ store, key, briefing, trigger, delivered, aiError, target, plan, generationMs, publishMs, startedAt, deliver }) {
  const at = new Date().toISOString();
  const items = briefing?.stats?.items ?? 0;
  const patch = {
    lastRunDate: key,
    lastRunAt: at,
    lastStatus: briefing.warnings.length > 0 ? 'partial' : 'ok',
    lastItems: items,
    lastIssues: briefing.warnings.length,
    lastTrigger: trigger,
    lastGenerationMs: generationMs,
    lastPublishMs: publishMs,
    lastScheduledFor: plan ? plan.publishAt.toISOString() : '',
    lastDelayMs: plan ? Math.max(0, Date.now() - plan.publishAt.getTime()) : Date.now() - startedAt,
    lastError: '',
  };
  if (deliver) {
    patch.lastDeliveredDate = key;
    patch.lastDeliveredAt = at;
  }
  store.updateState(patch);
  store.saveRuntime({
    ...(store.loadRuntime() || {}),
    lastDelivery: delivered,
    lastAiError: aiError,
    lastRunAt: at,
    lastTarget: target,
  });
}

export async function runBriefing(options = {}) {
  const storeDir = options.store ? path.resolve(options.store) : resolveStoreDir();
  const store = createStore(storeDir);
  const config = store.loadConfig();
  const now = options.now ? new Date(options.now) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`无效的 --now 时间：${options.now}`);
  // A pinned --now run stays on that clock; wall time is only the default, so a
  // replayed schedule never publishes early because the machine clock is late.
  const clockNow = () => (options.now ? now.getTime() : Date.now());
  const dryRun = Boolean(options.dryRun);
  const deliver = options.deliver !== false && !dryRun;
  const force = Boolean(options.force);
  const trigger = options.trigger || 'manual';
  const state = store.loadState();

  // The task has two daily triggers (prepare, publish) but a single action, so
  // the wall clock decides what this invocation is for.
  const plan = !dryRun && trigger === 'schedule' && !force
    ? resolveSchedulePhase({ now, schedule: config.schedule, timeZone: config.timezone })
    : null;
  const phase = dryRun ? 'preview' : plan ? plan.phase : 'full';
  const key = options.dateKey || (plan ? plan.dateKey : dateKey(now, config.timezone));

  if (phase === 'idle') {
    store.log(`skip: ${key} 已过期，等待下一期`);
    return { ok: true, skipped: true, reason: 'stale-publish', dateKey: key, phase };
  }

  if (!force && !dryRun && !options.dateKey) {
    if (phase === 'prepare' && (state.lastPrepareDate === key || state.lastRunDate === key)) {
      store.log(`skip: ${key} 已准备（phase=prepare）`);
      return { ok: true, skipped: true, reason: 'already-prepared', dateKey: key, phase };
    }
    if (phase === 'publish' && state.lastDeliveredDate === key) {
      store.log(`skip: ${key} 已发布（phase=publish）`);
      return { ok: true, skipped: true, reason: 'already-published', dateKey: key, phase };
    }
    if (phase === 'full' && state.lastRunDate === key) {
      store.log(`skip: ${key} 已生成（manual --force 可重跑）`);
      return { ok: true, skipped: true, reason: 'already-ran', dateKey: key, phase };
    }
  }

  const lock = acquireLock(store.dir);
  if (!lock.ok) {
    store.log(`skip: 另一个运行正在进行（${lock.holder || 'lock held'}）`);
    return { ok: true, skipped: true, reason: 'locked', dateKey: key, phase };
  }

  const startedAt = Date.now();
  const planLabel = plan
    ? ` · phase=${phase} · publish=${plan.publishAt.toISOString()}${plan.lateMs > 60 * 1000 ? ` · late=${Math.round(plan.lateMs / 60000)}min` : ''}`
    : '';
  store.log(`run start · ${key} · trigger=${trigger}${planLabel}${dryRun ? ' · dry-run' : ''}`);
  try {
    if (phase === 'preview') {
      const generated = await generateBriefing({ store, config, now, key, dryRun: true });
      return {
        ok: true,
        dryRun: true,
        phase,
        dateKey: key,
        briefing: generated.briefing,
        html: generated.html,
        email: generated.emailContent,
        elapsedMs: generated.elapsedMs,
      };
    }

    if (phase === 'prepare') {
      const generated = await generateBriefing({ store, config, now, key, dryRun: false });
      recordPrepared({ store, key, briefing: generated.briefing, elapsedMs: generated.elapsedMs });
      store.log(`prepared · ${generated.briefing.stats.items} 条 · ${generated.elapsedMs}ms`);

      // Preparing can take longer than the lead time (slow sources). If the
      // publish instant has arrived, deliver here instead of waiting for a
      // trigger that IgnoreNew may have already swallowed.
      if (clockNow() < plan.publishAt.getTime() - PUBLISH_EARLY_MS) {
        return {
          ok: true,
          phase,
          published: false,
          dateKey: key,
          target: generated.target,
          briefing: generated.briefing,
          elapsedMs: Date.now() - startedAt,
        };
      }

      store.log('  prep 完成时已到发布时间，直接发布');
      const delivery = await deliverBriefing({
        store,
        config,
        briefing: generated.briefing,
        emailContent: generated.emailContent,
        target: generated.target,
        deliver,
      });
      recordPublished({
        store,
        key,
        briefing: generated.briefing,
        trigger,
        delivered: delivery.delivered,
        aiError: generated.aiError,
        target: generated.target,
        plan,
        generationMs: generated.elapsedMs,
        publishMs: delivery.elapsedMs,
        startedAt,
        deliver,
      });
      store.log(`run done · phase=prepare→publish · ${generated.briefing.stats.items} 条 · ${Date.now() - startedAt}ms`);
      return {
        ok: true,
        phase,
        published: true,
        dateKey: key,
        target: generated.target,
        briefing: generated.briefing,
        delivery: delivery.delivered,
        elapsedMs: Date.now() - startedAt,
      };
    }

    if (phase === 'publish') {
      const existing = store.readBriefing(key);
      let briefing;
      let target;
      let emailContent;
      let generationMs = 0;
      let aiError = '';
      if (existing?.data) {
        briefing = existing.data;
        target = existing.dir;
        emailContent = renderBriefingEmail(briefing);
        store.log(`  复用 ${plan.leadMin} 分钟前准备的内容`);
      } else {
        const generated = await generateBriefing({ store, config, now, key, dryRun: false });
        briefing = generated.briefing;
        target = generated.target;
        emailContent = generated.emailContent;
        generationMs = generated.elapsedMs;
        aiError = generated.aiError;
        store.log('  没有已准备的简报，现场生成');
      }
      const delivery = await deliverBriefing({ store, config, briefing, emailContent, target, deliver });
      recordPublished({
        store,
        key,
        briefing,
        trigger,
        delivered: delivery.delivered,
        aiError,
        target,
        plan,
        generationMs,
        publishMs: delivery.elapsedMs,
        startedAt,
        deliver,
      });
      store.prune(config.retentionDays, now);
      store.log(`run done · phase=publish · ${briefing.stats.items} 条 · ${Date.now() - startedAt}ms`);
      return {
        ok: true,
        phase,
        reused: Boolean(existing?.data),
        dateKey: key,
        target,
        briefing,
        delivery: delivery.delivered,
        elapsedMs: Date.now() - startedAt,
      };
    }

    // Manual / forced run: generate and deliver in one pass.
    const generated = await generateBriefing({ store, config, now, key, dryRun: false });
    const delivery = await deliverBriefing({
      store,
      config,
      briefing: generated.briefing,
      emailContent: generated.emailContent,
      target: generated.target,
      deliver,
    });
    recordPublished({
      store,
      key,
      briefing: generated.briefing,
      trigger,
      delivered: delivery.delivered,
      aiError: generated.aiError,
      target: generated.target,
      plan: null,
      generationMs: generated.elapsedMs,
      publishMs: delivery.elapsedMs,
      startedAt,
      deliver,
    });
    store.prune(config.retentionDays, now);
    store.log(`run done · ${generated.briefing.stats.items} 条 · ${Date.now() - startedAt}ms`);
    return {
      ok: true,
      phase,
      dateKey: key,
      target: generated.target,
      briefing: generated.briefing,
      delivery: delivery.delivered,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (error) {
    store.log(`run failed: ${error.stack || error.message || error}`);
    store.updateState({
      lastError: String(error.message || error).slice(0, 800),
      lastRunAt: new Date().toISOString(),
      ...(phase === 'prepare' ? { lastPrepareError: String(error.message || error).slice(0, 800) } : {}),
    });
    return { ok: false, phase, error: String(error.message || error) };
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
