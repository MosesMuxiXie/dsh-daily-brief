/**
 * The briefing card: one narrow column, at most five rows of news, and a status
 * strip for the Minecraft server. Inline CSS, no external requests, warm light
 * theme with a dark-mode variant. Rendered standalone (file) and served through
 * /artifact for the in-app preview.
 */
import { escapeHtml } from '../text.js';

const TONES = { good: '#2f7d63', bad: '#b4553f' };

function badge(item) {
  if (!item?.badge) return '';
  const color = item.tone === 'good' ? TONES.good : item.tone === 'bad' ? TONES.bad : '#8a6a3d';
  return `<span class="badge" style="--badge:${color}">${escapeHtml(item.badge)}</span>`;
}

function itemRow(item, index) {
  const title = escapeHtml(item.title || '（无标题）');
  const link = item.url
    ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${title}</a>`
    : `<span>${title}</span>`;
  const meta = [item.sourceLabel, item.when].filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`).join('<i>·</i>');
  return `<li class="row">
      <span class="num">${String(index).padStart(2, '0')}</span>
      <div class="row-main">
        <div class="row-title">${badge(item)}${link}</div>
        <div class="row-meta">${meta}</div>
      </div>
    </li>`;
}

function serverStrip(section) {
  const server = section.server;
  const items = (section.items || []).slice(0, 4);
  if (items.length > 0) {
    const rows = items.map((item) => {
      const online = item.tone === 'good' || /在线|正常/.test(`${item.badge || ''}${item.title || ''}`);
      const state = item.badge || (online ? '在线' : '离线');
      const name = item.sourceLabel || item.title || '服务器';
      const detail = [item.detail || item.meta, item.when].filter(Boolean).join(' · ');
      return `<div class="server-row">
          <span class="dot ${online ? 'on' : 'off'}"></span>
          <strong class="server-name">${escapeHtml(name)}</strong>
          <span class="server-state">${escapeHtml(state)}</span>
          ${detail ? `<span class="server-detail">${escapeHtml(detail)}</span>` : ''}
        </div>`;
    }).join('');
    return `<section class="server">${rows}</section>`;
  }
  if (!server) return '';
  const online = Boolean(server.online);
  const dot = `<span class="dot ${online ? 'on' : 'off'}"></span>`;
  const players = online
    ? server.players?.max > 0
      ? `${server.players.online}/${server.players.max} 人在线`
      : '在线'
    : '离线';
  const detail = online
    ? [players, server.version, server.latency ? `${server.latency} ms` : ''].filter(Boolean).join(' · ')
    : '服务器没有响应，可能是关机或还没开服';
  return `<section class="server">
      <div class="server-head">${dot}<strong>${escapeHtml(server.label || '我的世界服务器')}</strong><span class="server-state">${escapeHtml(players)}</span></div>
      <div class="server-meta">${escapeHtml(detail)}</div>
      <div class="server-addr">${escapeHtml(server.address || '')}</div>
    </section>`;
}

function pointList(points) {
  const list = Array.isArray(points) ? points.filter((entry) => String(entry || '').trim() !== '') : [];
  if (list.length === 0) return '';
  return `<ul class="points">${list.map((entry) => `<li>${escapeHtml(String(entry).trim())}</li>`).join('')}</ul>`;
}

function sectionBlock(section) {
  if (section.id === 'server') return serverStrip(section);
  const empty = !section.items || section.items.length === 0;
  if (empty && !section.summary) return '';
  const digest = empty ? '' : String(section.digest || '').trim();
  const points = empty ? '' : pointList(section.points);
  const folded = digest !== '' || points !== '';
  const rows = empty || folded ? '' : section.items.map((item, index) => itemRow(item, index + 1)).join('');
  return `<section class="block${empty ? ' block-empty' : ''}">
      <header class="block-head">
        <span class="block-title" style="--accent:${section.accent}">${escapeHtml(section.zh)}</span>
        <span class="block-count">${empty ? '' : section.items.length}</span>
      </header>
      ${section.aiNote ? `<p class="ai-note">${escapeHtml(section.aiNote)}</p>` : ''}
      ${points}
      ${digest && !points ? `<p class="digest">${escapeHtml(digest)}</p>` : ''}
      ${empty ? `<p class="empty-note">${escapeHtml(section.summary || '暂时没有新内容')}</p>` : rows ? `<ol class="rows">${rows}</ol>` : ''}
    </section>`;
}

export function renderBriefingHtml(briefing) {
  const title = `${briefing.shortDate || briefing.dateLabel} 每日简报`;
  const blocks = (briefing.sections || []).map(sectionBlock).join('');
  const warning = Array.isArray(briefing.warnings) && briefing.warnings.length > 0
    ? `<p class="warn"><span class="warn-mark">!</span><span>${escapeHtml(briefing.warnings.slice(0, 2).join('；'))}</span></p>`
    : '';
  const intro = briefing.intro ? `<p class="intro">${escapeHtml(briefing.intro)}</p>` : '';
  const total = briefing.stats?.items ?? 0;
  const persona = briefing.persona || {};
  const accent = /^#[0-9a-f]{6}$/i.test(persona.accent || '') ? persona.accent : '#c2603f';
  const personaName = escapeHtml(persona.name || '每日简报');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f6f2ea;
    --card: #fffdf8;
    --ink: #26221d;
    --muted: #8b8175;
    --line: #eae2d6;
    --accent: #c2603f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --bg: #17151a;
      --card: #201d24;
      --ink: #efe9e2;
      --muted: #9a9188;
      --line: #322d36;
      --accent: #e08a63;
    }
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.55 "Segoe UI", "Microsoft YaHei", "PingFang SC", system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .card {
    max-width: 600px;
    margin: 0 auto;
    background: var(--card);
    min-height: 100vh;
    padding: 26px 24px 22px;
    border-inline: 1px solid var(--line);
  }
  .top { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; letter-spacing: .08em; }
  .top .spark { color: var(--accent); }
  .greet { margin: 18px 0 2px; color: var(--muted); font-size: 13px; }
  h1 {
    margin: 0;
    font-family: "Source Han Serif SC", "Songti SC", Georgia, serif;
    font-size: 27px;
    line-height: 1.28;
    font-weight: 600;
    letter-spacing: -.01em;
  }
  .intro { margin: 8px 0 0; color: var(--muted); font-size: 13px; }
  .warn { margin: 12px 0 0; display: flex; align-items: flex-start; gap: 6px; color: var(--muted); font-size: 11.5px; line-height: 1.5; }
  .warn-mark {
    flex: none; width: 13px; height: 13px; margin-top: 1px; border-radius: 50%;
    display: inline-flex; align-items: center; justify-content: center;
    background: color-mix(in srgb, var(--muted) 16%, transparent);
    color: var(--muted); font-size: 9px; font-weight: 700;
  }
  .block { margin-top: 26px; }
  .block-head { display: flex; align-items: baseline; justify-content: space-between; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .block-title { font-size: 12px; font-weight: 600; letter-spacing: .14em; color: var(--accent); }
  .block-count { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .rows { list-style: none; margin: 0; padding: 0; }
  .row { display: flex; gap: 12px; padding: 13px 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: 0; }
  .num { flex: none; width: 20px; padding-top: 2px; font: 11px/1.4 "SFMono-Regular", Consolas, monospace; color: var(--muted); font-variant-numeric: tabular-nums; }
  .row-main { min-width: 0; }
  .row-title { font-size: 15px; font-weight: 550; line-height: 1.45; overflow-wrap: anywhere; }
  .row-title a { color: inherit; text-decoration: none; }
  .row-title a:hover { text-decoration: underline; text-underline-offset: 3px; }
  .badge { display: inline-block; margin-right: 6px; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; color: var(--badge); border: 1px solid color-mix(in srgb, var(--badge) 35%, transparent); vertical-align: 1px; }
  .row-meta { margin-top: 4px; display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 11.5px; color: var(--muted); }
  .row-meta i { font-style: normal; opacity: .55; }
  .ai-note { margin: 8px 0 0; color: var(--muted); font-size: 12px; }
  .digest { margin: 10px 0 2px; color: var(--ink); font-size: 14px; line-height: 1.8; letter-spacing: .1px; }
  .points { margin: 12px 0 2px; padding: 0; list-style: none; }
  .points li { position: relative; padding-left: 16px; margin: 0 0 8px; color: var(--ink); font-size: 14px; line-height: 1.75; }
  .points li:last-child { margin-bottom: 0; }
  .points li::before { content: ''; position: absolute; left: 2px; top: .62em; width: 4px; height: 4px; border-radius: 50%; background: var(--accent); }
  .server { margin-top: 26px; padding: 14px 16px; border: 1px solid var(--line); border-radius: 10px; background: color-mix(in srgb, var(--bg) 45%, var(--card)); }
  .server-row { display: flex; align-items: center; gap: 8px; font-size: 13.5px; padding: 3px 0; }
  .server-row + .server-row { border-top: 1px dashed color-mix(in srgb, var(--line) 60%, transparent); margin-top: 6px; padding-top: 9px; }
  .server-name { font-weight: 600; }
  .server-detail { margin-left: auto; color: var(--muted); font-size: 11.5px; }
  .server-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; }
  .server-state { margin-left: auto; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .dot.on { background: #3a9d77; box-shadow: 0 0 0 3px rgba(58,157,119,.16); }
  .dot.off { background: #c06a50; box-shadow: 0 0 0 3px rgba(192,106,80,.14); }
  .server-meta { margin-top: 6px; color: var(--muted); font-size: 12px; }
  .server-addr { margin-top: 3px; color: var(--muted); font: 11px/1.5 "SFMono-Regular", Consolas, monospace; opacity: .8; }
  .foot { margin-top: 28px; padding-top: 14px; border-top: 1px solid var(--line); display: flex; justify-content: space-between; gap: 10px; color: var(--muted); font-size: 11px; }
  .block-empty .empty-note { margin: 12px 0 2px; color: var(--muted); font-size: 12.5px; }
  @media print { body { background: #fff; } .card { border: 0; } }
</style>
</head>
<body>
<main class="card" style="--accent:${escapeHtml(accent)}">
  <div class="top"><span class="spark">✦</span><span>DAILY BRIEF</span><span>·</span><span>${personaName}</span><span>·</span><span>${escapeHtml(briefing.dateLabel || '')}</span></div>
  <p class="greet">${escapeHtml(briefing.greeting || '')}</p>
  <h1>${escapeHtml(briefing.headline || '今天的简报')}</h1>
  ${intro}
  ${warning}
  ${blocks}
  <footer class="foot">
    <span>共 ${total} 条 · 生成于 ${escapeHtml(briefing.timeLabel || '')}</span>
    <span>${escapeHtml(briefing.scheduleNote || 'DSH 每日简报')}</span>
  </footer>
</main>
</body>
</html>`;
}
