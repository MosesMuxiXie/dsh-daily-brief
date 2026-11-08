/**
 * Daily Brief client half — one calm page.
 *
 * Three things only: today's card, the short list of things being watched, and
 * the time it should appear. Everything else (accounts, passwords, feeds,
 * formats) is gone on purpose; the panel saves as you type.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-daily-brief',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback } = React;

    const PANEL_ID = 'daily-brief';
    const API = 'api/daily-brief';

    const SECTION_ORDER = ['aiNews', 'gameNews', 'server', 'mail', 'feishu', 'managebac', 'calendar', 'tasks', 'custom'];
    const SECTION_LABEL = {
      aiNews: 'AI 动态',
      gameNews: '游戏',
      server: '服务器',
      mail: '邮箱',
      feishu: '飞书',
      managebac: '学校通知',
      calendar: '日历',
      tasks: '待办',
      custom: '其它',
    };
    const TYPE_LABEL = {
      x: 'X',
      steam: 'Steam',
      minecraft: 'Minecraft',
      rss: '订阅',
      atom: '订阅',
      json: 'JSON',
      ics: '日历',
      page: '网页',
      http: '状态',
      browser: '足迹',
      imap: '邮箱',
      graph: 'Outlook',
      managebac: 'ManageBac',
    };

    const CSS = `
.dbp-root { height:100%; overflow:auto; color-scheme:dark; background:var(--dsw-alias-bg-base,#0e0e12); color:var(--dsw-alias-label-primary,#ececf1); }
.dbp-page { max-width:1040px; margin:0 auto; padding:26px 24px 64px; }
      .dbp-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; align-items:start; margin-bottom:14px; }
      .dbp-grid > * { margin-bottom:0; min-width:0; }
      @media (max-width: 920px) { .dbp-grid { grid-template-columns:minmax(0,1fr); } }
      .dbp-group-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:16px; }
      .dbp-hint { margin:7px 0 0; color:var(--dsw-alias-label-tertiary); font-size:11.5px; line-height:1.6; }
      .dbp-src-edit { display:flex; gap:8px; align-items:center; margin:6px 0 4px 18px; }
      .dbp-src-edit .dbp-input { flex:1; }
.dbp-head { display:flex; align-items:center; gap:10px; margin-bottom:20px; }
.dbp-head h1 { margin:0; font-size:19px; font-weight:600; letter-spacing:-.01em; }
.dbp-head .dbp-sub { color:var(--dsw-alias-label-secondary); font-size:12px; margin-left:2px; }
.dbp-head-actions { margin-left:auto; display:flex; gap:8px; }
.dbp-btn { appearance:none; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); font:inherit; font-size:13px; line-height:1; padding:8px 14px; border-radius:8px; cursor:pointer; white-space:nowrap; transition:background .12s,border-color .12s; }
.dbp-btn:hover:not(:disabled) { background:var(--dsw-alias-bg-layer-3); border-color:var(--dsw-alias-label-dimmed); }
.dbp-btn:disabled { opacity:.5; cursor:default; }
.dbp-btn-primary { background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)); color:var(--dsw-alias-label-primary-foreground,#fff); border-color:transparent; }
.dbp-btn-primary:hover:not(:disabled) { filter:brightness(1.05); background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)); }
.dbp-btn-ghost { background:transparent; border-color:transparent; color:var(--dsw-alias-label-secondary); padding:6px 8px; }
.dbp-btn-ghost:hover:not(:disabled) { color:var(--dsw-alias-label-primary); background:var(--dsw-alias-bg-layer-2); }
.dbp-card { border:1px solid rgba(255,255,255,.09); background:#141418; border-radius:14px; padding:20px 22px; margin-bottom:14px; box-shadow:0 8px 24px rgba(0,0,0,.24); }
.dbp-card-quiet { background:#101013; border-color:rgba(255,255,255,.07); box-shadow:none; }
.dbp-style-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(148px,1fr)); gap:10px; margin-top:12px; }
.dbp-style { display:flex; flex-direction:column; gap:2px; text-align:left; padding:12px 13px; border-radius:12px; border:1px solid rgba(255,255,255,.1); background:#16161b; color:var(--dsw-alias-label-primary,#ececf1); cursor:pointer; font:inherit; }
.dbp-style:hover:not(:disabled) { border-color:var(--tone); }
.dbp-style.is-on { border-color:var(--tone); background:color-mix(in srgb,var(--tone) 16%,#16161b); }
.dbp-style:disabled { opacity:.55; cursor:default; }
.dbp-style-emoji { font-size:15px; line-height:1.4; }
.dbp-style-name { font-size:13px; font-weight:600; }
.dbp-style-tag { font-size:11px; line-height:1.4; color:rgba(255,255,255,.55); }
.dbp-style-custom { display:grid; gap:9px; margin-top:14px; padding-top:14px; border-top:1px solid rgba(255,255,255,.07); }
.dbp-style-custom label { display:grid; gap:4px; font-size:11px; color:rgba(255,255,255,.55); }
.dbp-color { width:46px; height:30px; padding:0; border:1px solid rgba(255,255,255,.14); border-radius:8px; background:#0b0b0e; }
.dbp-textarea-sm { min-height:66px; }
.dbp-note { margin:-4px 0 14px; padding:9px 12px; border:1px solid var(--dsw-alias-border-l1,#33333a); border-radius:10px; background:var(--dsw-alias-bg-layer-2,#17171b); color:var(--dsw-alias-label-secondary); font-size:12px; line-height:1.5; }
.dbp-note-inline { margin-top:9px; color:var(--dsw-alias-label-tertiary); font-size:11.5px; }
.dbp-label { font-size:11px; font-weight:600; letter-spacing:.12em; color:var(--dsw-alias-label-tertiary); text-transform:uppercase; }
.dbp-today-meta { display:flex; align-items:center; gap:8px; font-size:12px; color:var(--dsw-alias-label-secondary); margin-bottom:10px; }
.dbp-dot { width:6px; height:6px; border-radius:50%; background:var(--dsw-alias-state-success-primary,#2f9a6d); }
.dbp-dot.bad { background:var(--dsw-alias-state-error-primary,#c0533c); }
.dbp-headline { margin:0 0 4px; font-size:23px; line-height:1.35; font-weight:600; letter-spacing:-.015em; }
.dbp-intro { margin:0 0 14px; font-size:13px; color:var(--dsw-alias-label-secondary); }
.dbp-group { margin-top:18px; }
.dbp-group-title { display:flex; align-items:baseline; gap:8px; padding-bottom:7px; border-bottom:1px solid var(--dsw-alias-border-l1); margin-bottom:2px; }
.dbp-group-title span { font-size:11px; font-weight:600; letter-spacing:.1em; color:var(--dsw-alias-label-secondary); }
.dbp-group-title i { font-style:normal; font-size:11px; color:var(--dsw-alias-label-tertiary); margin-left:auto; }
.dbp-row { display:flex; gap:11px; padding:11px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.dbp-row:last-child { border-bottom:0; padding-bottom:2px; }
.dbp-num { flex:none; width:18px; padding-top:2px; font:11px/1.5 ui-monospace,Consolas,monospace; color:var(--dsw-alias-label-tertiary); }
.dbp-row-main { min-width:0; }
.dbp-row-title { font-size:14px; line-height:1.5; font-weight:500; }
.dbp-row-title a { color:inherit; text-decoration:none; }
.dbp-row-title a:hover { text-decoration:underline; text-underline-offset:3px; }
.dbp-row-meta { margin-top:3px; display:flex; flex-wrap:wrap; gap:5px; font-size:11.5px; color:var(--dsw-alias-label-tertiary); }
.dbp-row-meta em { font-style:normal; opacity:.5; }
.dbp-badge { display:inline-block; margin-right:6px; padding:0 5px; border-radius:4px; font-size:10px; line-height:16px; font-weight:600; border:1px solid currentColor; vertical-align:1px; }
.dbp-server { display:flex; flex-direction:column; gap:7px; margin-top:16px; padding:11px 13px; border:1px solid var(--dsw-alias-border-l1); border-radius:10px; background:var(--dsw-alias-bg-layer-2); font-size:12.5px; }
.dbp-server .dbp-srv-row { display:flex; align-items:center; gap:9px; }
.dbp-server .dbp-srv-row + .dbp-srv-row { border-top:1px dashed var(--dsw-alias-border-l1); padding-top:7px; }
.dbp-server .dbp-srv-name { font-weight:600; }
.dbp-server .dbp-srv-state { color:var(--dsw-alias-label-secondary); }
.dbp-server .dbp-srv-addr { margin-left:auto; font:11px/1.4 ui-monospace,Consolas,monospace; color:var(--dsw-alias-label-tertiary); }
.dbp-today-foot { display:flex; justify-content:space-between; gap:10px; margin-top:16px; padding-top:12px; border-top:1px solid var(--dsw-alias-border-l1); font-size:11.5px; color:var(--dsw-alias-label-tertiary); }
.dbp-warn { margin-top:10px; font-size:12px; color:var(--dsw-alias-state-warn-primary,#b57a2e); }
.dbp-quiet { padding:12px 0 2px; font-size:12.5px; color:var(--dsw-alias-label-tertiary); }
.dbp-digest { margin:10px 0 2px; font-size:13.5px; line-height:1.8; color:var(--dsw-alias-label-primary); }
.dbp-points { margin:11px 0 2px; padding:0; list-style:none; }
.dbp-points li { position:relative; padding-left:15px; margin-bottom:7px; font-size:13px; line-height:1.72; color:var(--dsw-alias-label-primary); }
.dbp-points li:last-child { margin-bottom:0; }
.dbp-points li::before { content:''; position:absolute; left:2px; top:.62em; width:4px; height:4px; border-radius:50%; background:#c46a4a; }
.dbp-linkbtn { margin-left:auto; padding:0; border:0; background:none; color:#8ab4f8; font-size:12px; cursor:pointer; }
.dbp-linkbtn:hover { text-decoration:underline; }
.dbp-style-notes { display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-top:12px; padding-top:12px; border-top:1px dashed rgba(255,255,255,.08); }
.dbp-style-notes-label { font-size:11.5px; color:var(--dsw-alias-label-tertiary); margin-right:2px; }
.dbp-pick-list { max-height:320px; overflow:auto; margin:4px 0 2px; border:1px solid rgba(255,255,255,.08); border-radius:10px; }
.dbp-pick { display:flex; align-items:center; gap:10px; width:100%; padding:10px 12px; border:0; border-bottom:1px solid rgba(255,255,255,.05); background:transparent; color:inherit; font-size:13px; text-align:left; cursor:pointer; }
.dbp-pick:last-child { border-bottom:0; }
.dbp-pick:hover { background:rgba(255,255,255,.04); }
.dbp-pick.is-on { background:rgba(138,180,248,.12); }
.dbp-pick-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dbp-pick-meta { color:var(--dsw-alias-label-tertiary); font-size:11.5px; font-variant-numeric:tabular-nums; }
.dbp-pick-check { color:#8ab4f8; font-weight:700; }
.dbp-empty { text-align:center; padding:34px 10px; }
.dbp-empty p { margin:0 0 14px; color:var(--dsw-alias-label-secondary); font-size:13px; }
.dbp-chips { display:flex; flex-wrap:wrap; gap:7px; margin-top:12px; }
.dbp-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 8px 5px 10px; border:1px solid var(--dsw-alias-border-l2); border-radius:999px; background:var(--dsw-alias-bg-layer-2); font-size:12.5px; }
.dbp-chip .dbp-x { appearance:none; border:0; background:transparent; color:var(--dsw-alias-label-tertiary); cursor:pointer; padding:0 2px; font-size:14px; line-height:1; }
.dbp-chip .dbp-x:hover { color:var(--dsw-alias-state-error-primary,#c0533c); }
.dbp-add { display:flex; gap:6px; margin-top:10px; }
.dbp-input { flex:1; min-width:0; height:32px; border:1px solid rgba(255,255,255,.12); background:#0b0b0e; color:var(--dsw-alias-label-primary); border-radius:7px; padding:0 10px; font:inherit; font-size:12.5px; }
.dbp-input:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.dbp-input-time { width:92px; height:32px; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-2); color:var(--dsw-alias-label-primary); border-radius:7px; padding:0 8px; font:inherit; font-size:13px; }
.dbp-line { display:flex; align-items:center; gap:10px; padding:11px 0; border-bottom:1px solid var(--dsw-alias-border-l1); }
.dbp-line:last-child { border-bottom:0; }
.dbp-line-label { font-size:13px; }
.dbp-line-hint { font-size:11.5px; color:var(--dsw-alias-label-tertiary); margin-top:2px; }
.dbp-line-spacer { margin-left:auto; }
.dbp-toggle { position:relative; width:34px; height:19px; border-radius:999px; border:0; padding:0; cursor:pointer; background:var(--dsw-alias-label-dimmed); transition:background .15s; flex:none; }
.dbp-toggle[aria-checked="true"] { background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-brand-primary)); }
.dbp-toggle span { position:absolute; top:2px; left:2px; width:15px; height:15px; border-radius:50%; background:#fff; transition:left .15s; }
.dbp-toggle[aria-checked="true"] span { left:17px; }
.dbp-history { list-style:none; margin:0; padding:0; }
.dbp-history li { display:flex; align-items:center; gap:10px; }
.dbp-history button { appearance:none; border:0; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; padding:9px 4px; border-radius:7px; display:flex; align-items:center; gap:10px; width:100%; }
.dbp-history button:hover { background:var(--dsw-alias-bg-layer-2); }
.dbp-history .dbp-hd-date { font-size:12.5px; color:var(--dsw-alias-label-secondary); font-variant-numeric:tabular-nums; width:86px; }
.dbp-history .dbp-hd-title { font-size:12.5px; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.dbp-history .dbp-hd-count { font-size:11px; color:var(--dsw-alias-label-tertiary); }
.dbp-flash { position:sticky; bottom:12px; margin:12px auto 0; width:fit-content; padding:7px 12px; border-radius:999px; font-size:12px; background:var(--dsw-alias-bg-layer-3); border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); }
.dbp-flash.err { color:var(--dsw-alias-state-error-primary,#c0533c); border-color:currentColor; }
.dbp-details { margin-top:6px; }
.dbp-details summary { cursor:pointer; font-size:12.5px; color:var(--dsw-alias-label-secondary); list-style:none; display:inline-flex; align-items:center; gap:5px; padding:4px 0; }
.dbp-details summary::-webkit-details-marker { display:none; }
.dbp-details summary:hover { color:var(--dsw-alias-label-primary); }
.dbp-details .dbp-line { border-bottom:0; }
.dbp-skel { height:14px; border-radius:5px; background:var(--dsw-alias-bg-layer-2); margin:8px 0; animation:dbp-pulse 1.4s ease-in-out infinite; }
@keyframes dbp-pulse { 0%,100%{opacity:.55} 50%{opacity:1} }
.dbp-error { padding:20px; font-size:13px; color:var(--dsw-alias-state-error-primary,#c0533c); }
.dbp-modal-mask { position:fixed; inset:0; z-index:60; background:rgba(0,0,0,.62); display:flex; align-items:center; justify-content:center; padding:32px 16px; overflow:auto; }
.dbp-modal { width:min(600px,100%); max-height:88vh; overflow:auto; background:#141418; border:1px solid rgba(255,255,255,.1); border-radius:14px; padding:18px 20px 16px; box-shadow:0 24px 70px rgba(0,0,0,.55); }
.dbp-modal h2 { margin:0 0 4px; font-size:16px; font-weight:600; }
.dbp-modal-sub { margin:0 0 12px; font-size:12px; line-height:1.65; color:var(--dsw-alias-label-secondary); }
.dbp-textarea { width:100%; min-height:132px; resize:vertical; border:1px solid rgba(255,255,255,.12); background:#0b0b0e; color:var(--dsw-alias-label-primary); border-radius:8px; padding:9px 11px; font:inherit; font-size:12.5px; line-height:1.6; }
.dbp-textarea:focus { outline:none; border-color:var(--dsw-alias-brand-primary); }
.dbp-modal-actions { display:flex; align-items:center; gap:8px; margin-top:12px; }
.dbp-modal-actions .dbp-line-spacer { margin-left:auto; }
.dbp-modal-err { margin-top:8px; font-size:11.5px; line-height:1.6; color:var(--dsw-alias-state-error-primary,#c0533c); }
.dbp-modal-ok { margin-top:8px; font-size:11.5px; color:var(--dsw-alias-label-secondary); }
.dbp-proposal { display:flex; gap:9px; align-items:flex-start; padding:11px 0; border-top:1px solid var(--dsw-alias-border-l1); }
.dbp-proposal > input { margin-top:4px; }
.dbp-proposal-main { flex:1; min-width:0; }
.dbp-proposal-head { display:flex; gap:7px; align-items:center; flex-wrap:wrap; }
.dbp-proposal-head .dbp-input { height:28px; font-size:12.5px; padding:0 8px; }
.dbp-tag { font-size:10.5px; line-height:16px; padding:0 6px; border-radius:5px; border:1px solid var(--dsw-alias-border-l2); color:var(--dsw-alias-label-secondary); white-space:nowrap; }
.dbp-proposal-note { margin-top:5px; font-size:11.5px; line-height:1.55; color:var(--dsw-alias-label-tertiary); }
.dbp-secret { margin-top:6px; }
.dbp-secret .dbp-input { height:30px; font-size:12px; }
.dbp-select { height:28px; border:1px solid rgba(255,255,255,.12); background:#0b0b0e; color:var(--dsw-alias-label-primary); border-radius:6px; padding:0 6px; font:inherit; font-size:11.5px; }
.dbp-src-group { margin-top:12px; }
.dbp-src-group-name { font-size:11px; font-weight:600; letter-spacing:.1em; color:var(--dsw-alias-label-tertiary); text-transform:uppercase; padding-bottom:4px; }
.dbp-src-row { display:flex; align-items:center; gap:8px; padding:8px 0; border-top:1px solid var(--dsw-alias-border-l1); font-size:12.5px; }
.dbp-src-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.dbp-src-type { font-size:10.5px; color:var(--dsw-alias-label-tertiary); }
.dbp-src-flag { font-size:10.5px; color:var(--dsw-alias-state-warn-primary,#b57a2e); white-space:nowrap; }
.dbp-src-actions { display:flex; align-items:center; gap:2px; }
.dbp-src-actions .dbp-btn-ghost { padding:4px 6px; font-size:11.5px; }
`;

    const TAG = 'daily-brief-panel-css';
    if (typeof document !== 'undefined' && !document.querySelector(`style[data-plugin-css="${TAG}"]`)) {
      const tag = document.createElement('style');
      tag.dataset.plugin = '@local/dsh-daily-brief';
      tag.dataset.pluginCss = TAG;
      tag.textContent = CSS;
      document.head.appendChild(tag);
    }

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function api(pathname, body, timeoutMs = 60000) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const init = { signal: controller.signal, headers: { 'x-daily-brief-client': '1' } };
        if (body !== undefined) {
          init.method = 'POST';
          init.headers['content-type'] = 'application/json';
          init.body = JSON.stringify(body);
        }
        const response = await fetch(`${API}${pathname}`, init);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data && data.error ? data.error : `请求失败（${response.status}）`);
        return data;
      } finally {
        clearTimeout(timer);
      }
    }

    function PanelIcon() {
      return h(
        'svg',
        { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
        h('path', { d: 'M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9L12 3z', stroke: 'currentColor', strokeWidth: 1.5, strokeLinejoin: 'round' }),
        h('circle', { cx: 18.5, cy: 17.5, r: 1.6, fill: 'currentColor', opacity: 0.5 }),
      );
    }

    function Btn(props) {
      const { variant, children, ...rest } = props;
      const cls = ['dbp-btn', variant === 'primary' ? 'dbp-btn-primary' : '', variant === 'ghost' ? 'dbp-btn-ghost' : ''].filter(Boolean).join(' ');
      return h('button', { type: 'button', className: cls, ...rest }, children);
    }

    function Toggle(props) {
      return h(
        'button',
        {
          type: 'button',
          className: 'dbp-toggle',
          role: 'switch',
          'aria-checked': props.checked ? 'true' : 'false',
          disabled: props.disabled,
          onClick: () => props.onChange(!props.checked),
          title: props.title,
        },
        h('span', null),
      );
    }

    function serverLine(section) {
      const items = (section.items || []).slice(0, 4);
      if (items.length > 0) {
        return h(
          'div',
          { className: 'dbp-server' },
          items.map((item, index) => {
            const online = item.tone === 'good' || /在线|正常/.test(`${item.badge || ''}${item.title || ''}`);
            return h(
              'div',
              { className: 'dbp-srv-row', key: index },
              h('span', { className: `dbp-dot${online ? '' : ' bad'}` }),
              h('span', { className: 'dbp-srv-name' }, item.sourceLabel || item.title || '服务器'),
              h('span', { className: 'dbp-srv-state' }, item.badge || (online ? '在线' : '离线')),
              h('span', { className: 'dbp-srv-addr' }, item.detail || item.meta || ''),
            );
          }),
        );
      }
      const server = section.server;
      if (!server) return null;
      const online = Boolean(server.online);
      const players = online
        ? server.players && server.players.max > 0
          ? `${server.players.online}/${server.players.max} 人在线`
          : '在线'
        : '离线';
      return h(
        'div',
        { className: 'dbp-server' },
        h(
          'div',
          { className: 'dbp-srv-row' },
          h('span', { className: `dbp-dot${online ? '' : ' bad'}` }),
          h('span', { className: 'dbp-srv-name' }, server.label || '我的世界服务器'),
          h('span', { className: 'dbp-srv-state' }, players),
          h('span', { className: 'dbp-srv-addr' }, server.address || ''),
        ),
      );
    }

    function Group(props) {
      const section = props.section;
      if (section.id === 'server') {
        const line = serverLine(section);
        if (!line) return null;
        return h('div', { className: 'dbp-group' }, line);
      }
      if (!section.items || section.items.length === 0) {
        if (section.id !== 'aiNews' && section.id !== 'gameNews') return null;
        return h(
          'div',
          { className: 'dbp-group' },
          h(
            'div',
            { className: 'dbp-group-title' },
            h('span', null, section.zh),
            h('i', null, '0 条'),
          ),
          h('div', { className: 'dbp-quiet' }, section.id === 'aiNews' ? '暂时没有新动态' : '暂时没有新公告'),
        );
      }
      const digest = typeof section.digest === 'string' ? section.digest.trim() : '';
      const points = Array.isArray(section.points) ? section.points.filter((entry) => String(entry || '').trim() !== '') : [];
      return h(
        'div',
        { className: 'dbp-group' },
        h(
          'div',
          { className: 'dbp-group-title' },
          h('span', null, section.zh),
          h('i', null, `${section.items.length} 条`),
        ),
        points.length > 0
          ? h('ul', { className: 'dbp-points' }, points.map((entry, index) => h('li', { key: `${section.id}-p-${index}` }, entry)))
          : digest
          ? h('p', { className: 'dbp-digest' }, digest)
          : section.items.map((item, index) =>
          h(
            'div',
            { className: 'dbp-row', key: `${section.id}-${item.url || item.title}-${index}` },
            h('span', { className: 'dbp-num' }, String(index + 1).padStart(2, '0')),
            h(
              'div',
              { className: 'dbp-row-main' },
              h(
                'div',
                { className: 'dbp-row-title' },
                item.badge ? h('span', { className: 'dbp-badge' }, item.badge) : null,
                item.url
                  ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer' }, item.title || '（无标题）')
                  : h('span', null, item.title || '（无标题）'),
              ),
              h(
                'div',
                { className: 'dbp-row-meta' },
                item.sourceLabel ? h('span', null, item.sourceLabel) : null,
                item.sourceLabel && item.when ? h('em', null, '·') : null,
                item.when ? h('span', null, item.when) : null,
              ),
            ),
          ),
        ),
      );
    }

    function TodayCard(props) {
      const { briefing, busy, onGenerate, onPopup, onOpenHistory } = props;
      if (!briefing) {
        return h(
          'div',
          { className: 'dbp-card' },
          h(
            'div',
            { className: 'dbp-empty' },
            h('p', null, '还没有生成过简报。点一下，看看今天有什么。'),
            h(Btn, { variant: 'primary', onClick: onGenerate, disabled: busy }, busy ? '生成中…' : '生成今天的简报'),
          ),
        );
      }
      const warnings = Array.isArray(briefing.warnings) ? briefing.warnings.filter(Boolean) : [];
      return h(
        'div',
        { className: 'dbp-card' },
        h(
          'div',
          { className: 'dbp-today-meta' },
          h('span', null, briefing.dateLabel || ''),
          h('span', null, briefing.timeLabel ? `生成于 ${briefing.timeLabel}` : ''),
        ),
        h('h2', { className: 'dbp-headline' }, briefing.headline || '今天的简报'),
        briefing.intro ? h('p', { className: 'dbp-intro' }, briefing.intro) : null,
        (briefing.sections || []).map((section) => h(Group, { key: section.id, section })),
        warnings.length > 0 ? h('div', { className: 'dbp-warn' }, warnings.slice(0, 2).join('；')) : null,
        h(
          'div',
          { className: 'dbp-today-foot' },
          h('span', null, `共 ${briefing.stats ? briefing.stats.items : 0} 条`),
          h(
            'span',
            null,
            h(Btn, { variant: 'ghost', onClick: onPopup }, '在桌面打开'),
            onOpenHistory ? h(Btn, { variant: 'ghost', onClick: onOpenHistory }, '全部往期') : null,
          ),
        ),
      );
    }

    function Chips(props) {
      return h(
        'div',
        { className: 'dbp-chips' },
        props.items.length === 0
          ? h('span', { style: { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' } }, props.empty || '还没有添加')
          : props.items.map((item) =>
              h(
                'span',
                { className: 'dbp-chip', key: item.id },
                h('span', null, item.label),
                props.locked
                  ? null
                  : h(
                      'button',
                      {
                        type: 'button',
                        className: 'dbp-x',
                        title: '移除',
                        'aria-label': `移除 ${item.label}`,
                        onClick: () => props.onRemove(item.id),
                      },
                      '×',
                    ),
              ),
            ),
      );
    }

    function AddRow(props) {
      const [value, setValue] = useState('');
      const [adding, setAdding] = useState(false);
      const [error, setError] = useState('');
      const submit = async () => {
        const text = value.trim();
        if (text === '' || adding) return;
        setAdding(true);
        setError('');
        try {
          await props.onAdd(text);
          setValue('');
        } catch (err) {
          setError(err && err.message ? err.message : String(err));
        } finally {
          setAdding(false);
        }
      };
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'dbp-add' },
          h('input', {
            className: 'dbp-input',
            value,
            placeholder: props.placeholder,
            spellCheck: false,
            onChange: (event) => {
              setValue(event.target.value);
              if (error) setError('');
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') submit();
            },
          }),
          h(Btn, { onClick: submit, disabled: adding || value.trim() === '' }, adding ? '添加中' : '添加'),
        ),
        error ? h('div', { className: 'dbp-modal-err' }, error) : null,
      );
    }

    function focusGroupOf(source) {
      if (source.type === 'x' || source.type === 'steam' || source.type === 'minecraft') return source.type;
      const url = String(source.url || '');
      if (/^minecraft:\/\//i.test(url)) return 'minecraft';
      if (/x\.com\/|twitter\.com\//i.test(url)) return 'x';
      if (/steampowered\.com|steamcommunity\.com/i.test(url)) return 'steam';
      if (source.section === 'aiNews') return 'x';
      if (source.section === 'gameNews') return 'steam';
      if (source.section === 'server') return 'minecraft';
      return '';
    }

    function xHandleOf(source) {
      const options = source.options || {};
      if (options.handle) return options.handle;
      const match = /x\.com\/([^/?#]+)/i.exec(source.url || '');
      return match ? match[1] : String(source.label || '').replace(/^@/, '');
    }

    function minecraftAddressOf(source) {
      const options = source.options || {};
      if (options.host) return options.port ? `${options.host}:${options.port}` : options.host;
      const match = /^minecraft:\/\/([^/]+)/i.exec(source.url || '');
      return match ? match[1] : source.label || '';
    }

    function FocusCard(props) {
      const { sources, onAdd, onRemove, locked, onPickSteam } = props;
      const groupOf = (kind) => sources.filter((source) => focusGroupOf(source) === kind);
      const x = groupOf('x');
      const steam = groupOf('steam');
      const minecraft = groupOf('minecraft');
      return h(
        'div',
        { className: 'dbp-card dbp-card-quiet' },
        h('div', { className: 'dbp-label' }, '关注范围'),
        h(
          'div',
          { className: 'dbp-group-grid' },
        h(
          'div',
          { className: 'dbp-group' },
          h('div', { className: 'dbp-group-title' }, h('span', null, 'X 上的 AI 账号')),
          h(Chips, {
            items: x.map((source) => ({ id: source.id, label: `@${xHandleOf(source)}` })),
            empty: '还没有关注任何账号',
            onRemove,
            locked,
          }),
          locked ? null : h(AddRow, { placeholder: '输入账号，例如 @OpenAI', onAdd: (value) => onAdd('x', value.replace(/^@/, '').trim()) }),
        ),
        h(
          'div',
          { className: 'dbp-group' },
          h(
            'div',
            { className: 'dbp-group-title' },
            h('span', null, '在玩的游戏'),
            onPickSteam && !locked
              ? h('button', { type: 'button', className: 'dbp-linkbtn', onClick: onPickSteam }, '从 Steam 库选择')
              : null,
          ),
          h(Chips, { items: steam.map((source) => ({ id: source.id, label: source.label })), empty: '还没有添加游戏', onRemove, locked }),
          locked ? null : h(AddRow, { placeholder: '输入 Steam appid，例如 502500', onAdd: (value) => onAdd('steam', value) }),
        ),
        h(
          'div',
          { className: 'dbp-group' },
          h('div', { className: 'dbp-group-title' }, h('span', null, '服务器与监控')),
          h(Chips, {
            items: minecraft.map((source) => ({ id: source.id, label: minecraftAddressOf(source) })),
            empty: '还没有添加服务器',
            onRemove,
            locked,
          }),
          locked ? null : h(AddRow, { placeholder: '地址:端口 或 http(s):// 监控页', onAdd: (value) => onAdd('minecraft', value) }),
        ),
        ),
      );
    }

    const BUILTIN_STYLES = [
      { id: 'whale', zh: '鲸鱼娘', accent: '#4aa8ff', tagline: '蓝色鲸鱼少女，聪明但懒，傲娇又甜', emoji: '🐋', notes: ['称你为「主人」', '自称「本鲸」', '拒绝被说胖', '材料不足会直说'] },
      { id: 'assistant', zh: '助手', accent: '#8ab4f8', tagline: '先结论、后背景，不讲废话', emoji: '🗂', notes: ['结论先行', '短句', '不寒暄', '标注不确定'] },
      { id: 'butler', zh: '管家', accent: '#c9a227', tagline: '正式、周到，像一份晨间汇报', emoji: '🎩', notes: ['称「您」', '结论→要点→留意', '不用感叹号'] },
      { id: 'officer', zh: '军官', accent: '#d05a4e', tagline: '作战简报：动词开头，数字优先', emoji: '🎖', notes: ['动词开头', '每条≤24字', '数字优先', '不提问题'] },
      { id: 'custom', zh: '自定义', accent: '#9a8cff', tagline: '名字、语气、颜色都由你定', emoji: '🎨', notes: ['名字', '一句话介绍', '主色', '语气'] },
    ];

    function StyleCard(props) {
      const { config, onSave, locked } = props;
      const persona = config.persona || {};
      const styles = Array.isArray(config.personaStyles) && config.personaStyles.length > 0 ? config.personaStyles : BUILTIN_STYLES;
      const current = persona.preset || 'whale';
      const patch = (extra) => onSave({ persona: { ...persona, ...extra } });
      const accent = /^#[0-9a-f]{6}$/i.test(persona.customAccent || '') ? persona.customAccent : '#9a8cff';
      return h(
        'div',
        { className: 'dbp-card dbp-card-quiet' },
        h('div', { className: 'dbp-label' }, '简报风格'),
        h(
          'div',
          { className: 'dbp-style-grid' },
          styles.map((style) => {
            const builtin = BUILTIN_STYLES.find((entry) => entry.id === style.id) || {};
            return h(
              'button',
              {
                key: style.id,
                type: 'button',
                className: `dbp-style${current === style.id ? ' is-on' : ''}`,
                style: { '--tone': style.accent || '#8ab4f8' },
                disabled: locked,
                onClick: () => patch({ preset: style.id }),
              },
              h('span', { className: 'dbp-style-emoji' }, builtin.emoji || '✦'),
              h('span', { className: 'dbp-style-name' }, style.zh || style.id),
              h('span', { className: 'dbp-style-tag' }, style.tagline || ''),
            );
          }),
        ),
        locked ? h('div', { className: 'dbp-note-inline' }, '重启一次 DSH 后，这里就可以切换风格') : null,
        (() => {
          const active = styles.find((style) => style.id === current) || {};
          const notes = Array.isArray(active.notes) && active.notes.length > 0 ? active.notes : (BUILTIN_STYLES.find((entry) => entry.id === current) || {}).notes;
          if (!Array.isArray(notes) || notes.length === 0) return null;
          return h(
            'div',
            { className: 'dbp-style-notes' },
            h('span', { className: 'dbp-style-notes-label' }, '这张卡的约束'),
            notes.map((note) => h('span', { className: 'dbp-tag', key: `${current}-${note}` }, note)),
          );
        })(),
        current === 'custom'
          ? h(
              'div',
              { className: 'dbp-style-custom' },
              h(
                'label',
                null,
                '名字',
                h('input', {
                  className: 'dbp-input',
                  value: persona.customName || '',
                  spellCheck: false,
                  disabled: locked,
                  placeholder: '例如 深夜电台',
                  onChange: (event) => patch({ customName: event.target.value }),
                }),
              ),
              h(
                'label',
                null,
                '一句话',
                h('input', {
                  className: 'dbp-input',
                  value: persona.customTagline || '',
                  spellCheck: false,
                  disabled: locked,
                  placeholder: '例如 慢慢说，不着急',
                  onChange: (event) => patch({ customTagline: event.target.value }),
                }),
              ),
              h(
                'label',
                null,
                '主色',
                h('input', {
                  className: 'dbp-color',
                  type: 'color',
                  value: accent,
                  disabled: locked,
                  onChange: (event) => patch({ customAccent: event.target.value }),
                }),
              ),
              h(
                'label',
                null,
                '语气',
                h('textarea', {
                  className: 'dbp-textarea dbp-textarea-sm',
                  rows: 3,
                  value: persona.customPrompt || '',
                  spellCheck: false,
                  disabled: locked,
                  placeholder: '例如：语气温柔、轻快，句尾偶尔带「呀」',
                  onChange: (event) => patch({ customPrompt: event.target.value }),
                }),
              ),
            )
          : null,
      );
    }

    function RhythmCard(props) {
      const { config, onSave, onTestPopup } = props;
      const popup = (config.delivery && config.delivery.popup) || {};
      const schedule = config.schedule || { time: '07:30', enabled: true };
      return h(
        'div',
        { className: 'dbp-card dbp-card-quiet' },
        h('div', { className: 'dbp-label' }, '节奏'),
        h(
          'div',
          { className: 'dbp-line' },
          h('div', null, h('div', { className: 'dbp-line-label' }, '每天生成'), h('div', { className: 'dbp-line-hint' }, '到点后自动收集并弹出')),
          h('div', { className: 'dbp-line-spacer' }),
          h('input', {
            className: 'dbp-input-time',
            type: 'time',
            value: schedule.time || '07:30',
            onChange: (event) => onSave({ schedule: { ...schedule, time: event.target.value || '07:30' } }),
          }),
          h(Toggle, {
            checked: schedule.enabled !== false,
            onChange: (value) => onSave({ schedule: { ...schedule, enabled: value } }),
          }),
        ),
        h(
          'div',
          { className: 'dbp-line' },
          h('div', null, h('div', { className: 'dbp-line-label' }, '生成后弹出窗口'), h('div', { className: 'dbp-line-hint' }, '取代原来的系统通知')),
          h('div', { className: 'dbp-line-spacer' }),
          h(Btn, { variant: 'ghost', onClick: onTestPopup }, '试一下'),
          h(Toggle, {
            checked: popup.openOnGenerate !== false,
            onChange: (value) => onSave({ delivery: { ...config.delivery, popup: { ...popup, openOnGenerate: value, enabled: value || popup.enabled } } }),
          }),
        ),
      );
    }

    function HistoryCard(props) {
      const { briefings, onOpen } = props;
      if (!briefings || briefings.length === 0) return null;
      return h(
        'div',
        { className: 'dbp-card dbp-card-quiet' },
        h('div', { className: 'dbp-label', style: { marginBottom: 6 } }, '往期'),
        h(
          'ul',
          { className: 'dbp-history' },
          briefings.slice(0, 6).map((row) =>
            h(
              'li',
              { key: row.id },
              h(
                'button',
                { type: 'button', onClick: () => onOpen(row.id), title: '在桌面打开这一期' },
                h('span', { className: 'dbp-hd-date' }, row.id),
                h('span', { className: 'dbp-hd-title' }, row.headline || '每日简报'),
                h('span', { className: 'dbp-hd-count' }, `${row.items || 0} 条`),
              ),
            ),
          ),
        ),
      );
    }

    function AdvancedCard(props) {
      const { state, onOpenFolder, onSave } = props;
      const config = state.config || {};
      return h(
        'details',
        { className: 'dbp-details' },
        h('summary', null, '更多'),
        h(
          'div',
          { className: 'dbp-card dbp-card-quiet' },
          h(
            'div',
            { className: 'dbp-line' },
            h('div', null, h('div', { className: 'dbp-line-label' }, '保留天数'), h('div', { className: 'dbp-line-hint' }, '超过的旧简报会自动清理')),
            h('div', { className: 'dbp-line-spacer' }),
            h('input', {
              className: 'dbp-input-time',
              type: 'number',
              min: 1,
              max: 365,
              value: config.retentionDays || 30,
              onChange: (event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value >= 1) onSave({ retentionDays: value });
              },
            }),
          ),
          h(
            'div',
            { className: 'dbp-line' },
            h('div', null, h('div', { className: 'dbp-line-label' }, '数据'), h('div', { className: 'dbp-line-hint' }, state.paths ? state.paths.store : '')),
            h('div', { className: 'dbp-line-spacer' }),
            h(Btn, { variant: 'ghost', onClick: () => onOpenFolder('store') }, '打开文件夹'),
            state.paths && state.paths.artifact
              ? h(Btn, { variant: 'ghost', onClick: () => onOpenFolder('briefing') }, '打开简报文件')
              : null,
          ),
        ),
      );
    }

    function Modal(props) {
      return h(
        'div',
        { className: 'dbp-modal-mask', role: 'dialog', 'aria-modal': 'true' },
        h(
          'div',
          { className: 'dbp-modal' },
          h('h2', null, props.title),
          props.sub ? h('p', { className: 'dbp-modal-sub' }, props.sub) : null,
          props.children,
        ),
      );
    }

    function requiresOf(proposal) {
      return Array.isArray(proposal.requires) ? proposal.requires : [];
    }

    function SteamPicker(props) {
      const { onClose, onAdded } = props;
      const [loading, setLoading] = useState(true);
      const [games, setGames] = useState([]);
      const [error, setError] = useState('');
      const [picked, setPicked] = useState({});
      const [busy, setBusy] = useState(false);

      useEffect(() => {
        let alive = true;
        api('/steam/library', {}, 120000)
          .then((result) => {
            if (!alive) return;
            setGames(Array.isArray(result.games) ? result.games : []);
            setLoading(false);
          })
          .catch((failure) => {
            if (!alive) return;
            setError(String(failure.message || failure));
            setLoading(false);
          });
        return () => {
          alive = false;
        };
      }, []);

      const chosen = Object.values(picked);
      const submit = async () => {
        if (chosen.length === 0 || busy) return;
        setBusy(true);
        try {
          await api('/sources', {
            proposals: chosen.map((game) => ({
              type: 'steam',
              section: 'gameNews',
              label: game.name,
              options: { appid: game.appid, limit: 3, sinceHours: 24 * 14 },
            })),
          }, 120000);
          onAdded(chosen.length);
        } catch (failure) {
          setError(String(failure.message || failure));
          setBusy(false);
        }
      };

      const body = loading
        ? h('p', { className: 'dbp-quiet' }, '正在读取本机 Steam 库…')
        : games.length === 0
        ? h('p', { className: 'dbp-quiet' }, '没有找到已安装的 Steam 游戏。确认 Steam 已安装并且至少登录过一次。')
        : h(
            'div',
            { className: 'dbp-pick-list' },
            games.map((game) => {
              const on = Boolean(picked[game.appid]);
              return h(
                'button',
                {
                  key: game.appid,
                  type: 'button',
                  className: `dbp-pick${on ? ' is-on' : ''}`,
                  onClick: () => setPicked((prev) => ({ ...prev, [game.appid]: prev[game.appid] ? null : { appid: game.appid, name: game.name } })),
                },
                h('span', { className: 'dbp-pick-name' }, game.name),
                h('span', { className: 'dbp-pick-meta' }, String(game.appid)),
                on ? h('span', { className: 'dbp-pick-check' }, '✓') : null,
              );
            }),
          );

      return h(
        Modal,
        {
          title: '从 Steam 库选择',
          sub: '只读本机已安装列表，选中后作为「在玩的游戏」加入，之后仍可删改。',
        },
        body,
        error ? h('p', { className: 'dbp-modal-err' }, error) : null,
        h(
          'div',
          { className: 'dbp-modal-actions' },
          h('button', { type: 'button', className: 'dbp-btn', onClick: submit, disabled: busy || chosen.length === 0 }, busy ? '加入中…' : `加入 ${chosen.length} 个`),
          h('button', { type: 'button', className: 'dbp-btn dbp-btn-ghost', onClick: onClose }, '关闭'),
        ),
      );
    }

    function AddSourceDialog(props) {
      const { onClose, onAdded, locked } = props;
      const [text, setText] = useState('');
      const [busy, setBusy] = useState('');
      const [rows, setRows] = useState([]);
      const [errors, setErrors] = useState([]);
      const [message, setMessage] = useState('');

      const probe = async () => {
        if (busy) return;
        setBusy('probe');
        setErrors([]);
        setMessage('');
        try {
          const result = await api('/probe', { text }, 120000);
          const detected = (result.results || []).map((proposal, index) => ({
            key: index,
            checked: proposal.ok !== false && !requiresOf(proposal).includes('microsoft'),
            label: proposal.label || '',
            section: proposal.section || 'custom',
            secret: '',
            host: '',
            proposal,
          }));
          const fallback = [];
          const lines = String(text || '').split(/[\n,;，；]+/).map((line) => line.trim()).filter(Boolean);
          for (const line of lines) {
            if (!/^https?:\/\//i.test(line)) continue;
            if (detected.some((row) => row.proposal && row.proposal.url === line)) continue;
            let parsed = null;
            try { parsed = new URL(line); } catch { continue; }
            if (!parsed.hostname) continue;
            const host = parsed.hostname;
            const serverish = /server|monitor|status|panel|mcs|minecraft|dashboard|console|监控|服务器|后台/i.test(line);
            const privateHost = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1)$/i.test(host)
              || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
            const section = serverish || privateHost ? 'server' : 'custom';
            fallback.push({
              key: detected.length + fallback.length,
              checked: true,
              label: host,
              section,
              secret: '',
              host: '',
              proposal: {
                type: 'http',
                section,
                label: host,
                url: line,
                options: { allowPrivate: privateHost },
                note: '未识别为订阅，按网页来源加入（记录在线状态与响应时间）。',
              },
            });
          }
          const list = detected.concat(fallback);
          setRows(list);
          setErrors(result.errors || []);
          if (list.length === 0) setMessage('没有识别出可添加的来源');
          else if (fallback.length > 0) setMessage(`已按网页来源补上 ${fallback.length} 个链接，确认后点「加入」`);
        } catch (err) {
          setErrors([err.message || String(err)]);
        } finally {
          setBusy('');
        }
      };

      const patchRow = (key, patch) => setRows((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));

      const submit = async () => {
        if (busy) return;
        const picked = rows.filter((row) => row.checked);
        if (picked.length === 0) {
          setMessage('先勾选要添加的来源');
          return;
        }
        setBusy('add');
        setErrors([]);
        let added = 0;
        const failures = [];
        for (const row of picked) {
          try {
            const proposal = { ...row.proposal, label: row.label || row.proposal.label, section: row.section };
            if (row.host) proposal.account = { ...(proposal.account || {}), host: row.host.trim() };
            const result = await api('/sources', { proposals: [proposal] });
            const created = (result.added || [])[0];
            if (!created) continue;
            const need = requiresOf(row.proposal);
            const value = row.secret.trim();
            if (value !== '' && need.includes('password')) {
              await api('/secret', { sourceId: created.id, field: 'password', value });
            }
            if (value !== '' && need.includes('cookie')) {
              const headers = value.startsWith('{') ? value : JSON.stringify({ cookie: value });
              await api('/secret', { sourceId: created.id, field: 'headers', value: headers });
            }
            added += 1;
          } catch (err) {
            failures.push(`${row.label || '来源'}：${err.message || String(err)}`);
          }
        }
        setBusy('');
        if (failures.length > 0) {
          setErrors(failures);
          setMessage(`已添加 ${added} 个，${failures.length} 个失败`);
          return;
        }
        onAdded(added);
        onClose();
      };

      return h(
        Modal,
        {
          title: '添加来源',
          sub: '粘贴网址、邮箱地址或服务器地址，每行一个。支持订阅源、网页、日历 ICS、邮箱（IMAP）、ManageBac、飞书、Steam 与 Minecraft。',
        },
        locked ? h('div', { className: 'dbp-note' }, 'DSH 主进程还停在旧版插件，重启一次后再添加。') : null,
        h('textarea', {
          className: 'dbp-textarea',
          value: text,
          spellCheck: false,
          placeholder: '例如：\nhttps://www.managebac.com/student/\nme@school.edu\nhttps://example.com/feed.xml\nplay.example.com:25565',
          onChange: (event) => setText(event.target.value),
        }),
        h(
          'div',
          { className: 'dbp-modal-actions' },
          h(Btn, { onClick: probe, disabled: Boolean(busy) || text.trim() === '' || locked }, busy === 'probe' ? '识别中…' : '识别'),
          h('div', { className: 'dbp-line-spacer' }),
          h(Btn, { onClick: onClose }, '关闭'),
          rows.length > 0 ? h(Btn, { variant: 'primary', onClick: submit, disabled: Boolean(busy) || locked }, busy === 'add' ? '添加中…' : `加入 ${rows.filter((row) => row.checked).length} 个`) : null,
        ),
        message ? h('div', { className: 'dbp-modal-ok' }, message) : null,
        errors.length > 0 ? h('div', { className: 'dbp-modal-err' }, errors.join('；')) : null,
        rows.map((row) => {
          const proposal = row.proposal;
          const need = requiresOf(proposal);
          const microsoft = need.includes('microsoft');
          const preview = proposal.preview || {};
          return h(
            'div',
            { className: 'dbp-proposal', key: row.key },
            h('input', {
              type: 'checkbox',
              checked: row.checked,
              disabled: microsoft || locked,
              onChange: (event) => patchRow(row.key, { checked: event.target.checked }),
            }),
            h(
              'div',
              { className: 'dbp-proposal-main' },
              h(
                'div',
                { className: 'dbp-proposal-head' },
                h('input', {
                  className: 'dbp-input',
                  value: row.label,
                  spellCheck: false,
                  onChange: (event) => patchRow(row.key, { label: event.target.value }),
                }),
                h('span', { className: 'dbp-tag' }, TYPE_LABEL[proposal.type] || proposal.type),
                h(
                  'select',
                  {
                    className: 'dbp-select',
                    value: row.section,
                    onChange: (event) => patchRow(row.key, { section: event.target.value }),
                  },
                  SECTION_ORDER.map((id) => h('option', { key: id, value: id }, SECTION_LABEL[id] || id)),
                ),
                microsoft ? h('span', { className: 'dbp-src-flag' }, '需要 Microsoft 授权，暂不支持') : null,
              ),
              preview.subtitle || proposal.note
                ? h('div', { className: 'dbp-proposal-note' }, [preview.subtitle, proposal.note].filter(Boolean).join(' · '))
                : null,
              need.includes('imapHost')
                ? h('div', { className: 'dbp-secret' }, h('input', {
                    className: 'dbp-input',
                    value: row.host,
                    spellCheck: false,
                    placeholder: 'IMAP 服务器，例如 imap.school.edu',
                    onChange: (event) => patchRow(row.key, { host: event.target.value }),
                  }))
                : null,
              need.includes('password')
                ? h('div', { className: 'dbp-secret' }, h('input', {
                    className: 'dbp-input',
                    type: 'password',
                    value: row.secret,
                    spellCheck: false,
                    placeholder: '邮箱密码或授权码（保存在本机 DPAPI 加密文件里）',
                    onChange: (event) => patchRow(row.key, { secret: event.target.value }),
                  }))
                : null,
              need.includes('cookie')
                ? h(
                    'div',
                    { className: 'dbp-secret' },
                    h('input', {
                      className: 'dbp-input',
                      value: row.secret,
                      spellCheck: false,
                      placeholder: row.proposal.type === 'managebac' ? '登录 Cookie 的值（只填 cookie 后面那段，可不填，添加后也能补）' : '登录 Cookie 的值（也可先留空，添加后在来源里补填）',
                      onChange: (event) => patchRow(row.key, { secret: event.target.value }),
                    }),
                    h(
                      'div',
                      { className: 'dbp-hint' },
                      '怎么取：浏览器登录后按 F12 → Network → 刷新页面 → 点任意一个请求 → 在 Request Headers 里找到 cookie，复制冒号后的整段值。',
                    ),
                    row.proposal.type === 'managebac'
                      ? h(
                          'div',
                          { className: 'dbp-hint' },
                          'ManageBac 也可以不填 Cookie：在学校的 ManageBac「日历 / Calendar」里复制 ICS 订阅链接，粘贴到上面的输入框即可（更像订阅源，也更稳定）。',
                        )
                      : null,
                  )
                : null,
            ),
          );
        }),
      );
    }

    function SourcesCard(props) {
      const { sources, secrets, locked, onAdd, onTest, onToggle, onRemove, onSecret } = props;
      const [edit, setEdit] = useState(null);
      const [value, setValue] = useState('');
      const [busy, setBusy] = useState(false);
      const [err, setErr] = useState('');
      const list = Array.isArray(sources) ? sources : [];
      if (list.length === 0) return null;
      const secretFor = (source) => (secrets && secrets.sources ? secrets.sources[source.id] || {} : {});
      return h(
        'details',
        { className: 'dbp-details' },
        h(
          'summary',
          null,
          `来源 · ${list.length} 个`,
          h('span', { className: 'dbp-src-type' }, '点开管理'),
        ),
        h(
          'div',
          { className: 'dbp-card dbp-card-quiet' },
          SECTION_ORDER.map((sectionId) => {
            const group = list.filter((source) => (source.section || 'custom') === sectionId);
            if (group.length === 0) return null;
            return h(
              'div',
              { className: 'dbp-src-group', key: sectionId },
              h('div', { className: 'dbp-src-group-name' }, SECTION_LABEL[sectionId] || sectionId),
              group.map((source) => {
                const status = secretFor(source);
                const needPassword = source.type === 'imap' && status.password === false;
                const needCookie = (source.type === 'page' || source.type === 'managebac') && status.cookie === false;
                const field = needPassword ? 'password' : needCookie ? 'headers' : '';
                const editing = Boolean(edit && edit.id === source.id);
                return h(
                  'div',
                  { className: 'dbp-src-item', key: source.id },
                  h(
                    'div',
                    { className: 'dbp-src-row' },
                    h('span', { className: `dbp-dot${source.enabled === false ? ' bad' : ''}` }),
                    h('span', { className: 'dbp-src-name', title: source.url || source.label }, source.label || source.type),
                    h('span', { className: 'dbp-src-type' }, TYPE_LABEL[source.type] || source.type),
                    needPassword ? h('span', { className: 'dbp-src-flag' }, '未填密码') : null,
                    needCookie ? h('span', { className: 'dbp-src-flag' }, '未填 Cookie') : null,
                    h(
                      'div',
                      { className: 'dbp-src-actions' },
                      field
                        ? h(
                            Btn,
                            {
                              variant: 'ghost',
                              disabled: locked,
                              onClick: () => {
                                setEdit({ id: source.id, field });
                                setValue('');
                                setErr('');
                              },
                            },
                            '补填',
                          )
                        : null,
                      h(Btn, { variant: 'ghost', onClick: () => onTest(source), title: '立即抓取一次' }, '测试'),
                      h(Toggle, {
                        checked: source.enabled !== false,
                        disabled: locked,
                        onChange: (enabled) => onToggle(source, enabled),
                        title: source.enabled === false ? '启用' : '停用',
                      }),
                      h(Btn, { variant: 'ghost', onClick: () => onRemove(source), disabled: locked, title: '移除' }, '×'),
                    ),
                  ),
                  editing
                    ? h(
                        'div',
                        { className: 'dbp-src-edit' },
                        h('input', {
                          className: 'dbp-input',
                          value,
                          spellCheck: false,
                          placeholder: edit.field === 'headers' ? '粘贴 cookie 的值（F12 → Network → 请求头里的 cookie）' : '邮箱密码或授权码',
                          onChange: (event) => setValue(event.target.value),
                        }),
                        h(
                          Btn,
                          {
                            variant: 'primary',
                            disabled: busy,
                            onClick: async () => {
                              setBusy(true);
                              setErr('');
                              try {
                                await onSecret(source, edit.field, value);
                                setEdit(null);
                                setValue('');
                              } catch (error) {
                                setErr(error.message || String(error));
                              } finally {
                                setBusy(false);
                              }
                            },
                          },
                          busy ? '保存中…' : '保存',
                        ),
                        h(Btn, { onClick: () => { setEdit(null); setValue(''); setErr(''); } }, '取消'),
                        err ? h('span', { className: 'dbp-modal-err' }, err) : null,
                      )
                    : null,
                );
              }),
            );
          }),
          h(
            'div',
            { className: 'dbp-line', style: { borderBottom: 0, paddingBottom: 0 } },
            h('div', { className: 'dbp-line-hint' }, '登录类来源（邮箱 / ManageBac / 飞书）会出现「未填 Cookie」提示，点该行的「补填」粘贴登录 Cookie 即可；ManageBac 也可以改用日历 ICS 订阅链接。'),
            h('div', { className: 'dbp-line-spacer' }),
            h(Btn, { variant: 'ghost', onClick: onAdd, disabled: locked }, '添加来源'),
          ),
        ),
      );
    }

    function App() {
      const [state, setState] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState('');
      const [flash, setFlash] = useState(null);
      const [addOpen, setAddOpen] = useState(false);
      const [steamOpen, setSteamOpen] = useState(false);
      const saveTimer = useRef(null);
      const caps = state && Array.isArray(state.capabilities) ? state.capabilities : [];
      const stale = Boolean(state && (!caps.includes('popup') || !caps.includes('persona2')));
      const staleRef = useRef(stale);
      staleRef.current = stale;

      const flashWith = useCallback((text, kind) => {
        setFlash({ text, kind });
        window.clearTimeout(flashWith.timer);
        flashWith.timer = window.setTimeout(() => setFlash(null), 2600);
      }, []);

      const refresh = useCallback(async () => {
        try {
          const next = await api('/state');
          setState(next);
          setError('');
          return next;
        } catch (err) {
          setError(err.message || String(err));
          return null;
        }
      }, []);

      useEffect(() => {
        refresh();
        const timer = window.setInterval(() => {
          if (document.visibilityState === 'visible') refresh();
        }, 30000);
        return () => window.clearInterval(timer);
      }, [refresh]);

      const save = useCallback(
        async (patch, options = {}) => {
          if (staleRef.current) {
            flashWith('先重启一次 DSH，设置才能保存', 'err');
            return;
          }
          try {
            const result = await api('/config', { patch });
            setState((prev) => (prev ? { ...prev, config: result.config } : prev));
            if (!options.quiet) flashWith('已保存');
          } catch (err) {
            flashWith(err.message, 'err');
          }
        },
        [flashWith],
      );

      const saveDebounced = useCallback(
        (patch) => {
          window.clearTimeout(saveTimer.current);
          saveTimer.current = window.setTimeout(() => save(patch, { quiet: true }), 550);
        },
        [save],
      );

      const generate = useCallback(async () => {
        if (busy) return;
        setBusy('run');
        setFlash(null);
        try {
          const before = state && state.state ? state.state.lastRunAt : '';
          await api('/run', { force: true });
          let next = null;
          for (let i = 0; i < 26; i += 1) {
            await sleep(1500);
            const candidate = await api('/state');
            const at = candidate.state ? candidate.state.lastRunAt : '';
            if (at !== before || (candidate.state && candidate.state.lastError)) {
              next = candidate;
              break;
            }
          }
          if (next) {
            setState(next);
            flashWith(next.state && next.state.lastError ? '生成遇到问题，看看来源是否可用' : '已生成');
          } else {
            await refresh();
            flashWith('后台还在生成，稍后会自己出现');
          }
        } catch (err) {
          flashWith(err.message || String(err), 'err');
        } finally {
          setBusy('');
        }
      }, [busy, state, refresh, flashWith]);

      const popup = useCallback(
        async (id) => {
          if (staleRef.current) {
            flashWith('先重启一次 DSH，桌面弹窗才能启用', 'err');
            return;
          }
          try {
            const result = await api('/popup', { id: id || 'latest' }, 30000);
            if (!result.ok) throw new Error(result.error || '打不开窗口');
            flashWith(result.mode === 'app' ? '已在桌面打开' : result.message || '已打开');
          } catch (err) {
            flashWith(err.message || String(err), 'err');
          }
        },
        [flashWith],
      );

      const addSource = useCallback(
        async (type, raw) => {
          if (staleRef.current) {
            flashWith('先重启一次 DSH，再修改关注范围', 'err');
            return;
          }
          const value = type === 'minecraft' ? raw.replace(/^minecraft:\/\//i, '').trim() : raw.trim();
          if (type === 'steam' && !/^\d+$/.test(value)) throw new Error('请输入数字 appid，例如 730');
          if (type === 'minecraft' && /^https?:\/\//i.test(value)) {
            // A monitor page belongs under servers, but it is watched by URL,
            // not by the Minecraft protocol.
            let parsed;
            try {
              parsed = new URL(value);
            } catch {
              throw new Error('网址格式不对，例如 http://panel.example.com:8080/');
            }
            const result = await api('/sources', {
              proposals: [
                {
                  type: 'http',
                  section: 'server',
                  label: parsed.hostname,
                  url: parsed.href,
                  options: { allowPrivate: true },
                },
              ],
            });
            setState((prev) => (prev ? { ...prev, sources: result.sources } : prev));
            flashWith('已添加服务器监控');
            return;
          }
          if (type === 'minecraft') {
            const match = value.match(/^([^\s:]+)(?::(\d{1,5}))?$/);
            if (!match) throw new Error('格式应为 地址:端口 或 http(s):// 监控地址');
            const port = match[2] ? Number(match[2]) : 25565;
            if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error('端口应为 1-65535');
            const result = await api('/sources', {
              proposals: [{ type: 'minecraft', section: 'server', label: '我的世界服务器', options: { host: match[1], port } }],
            });
            setState((prev) => (prev ? { ...prev, sources: result.sources } : prev));
            flashWith('已添加');
            return;
          }
          const proposals =
            type === 'x'
              ? [{ type: 'x', section: 'aiNews', label: `@${value}`, options: { handle: value } }]
              : [{ type: 'steam', section: 'gameNews', label: `Steam ${value}`, options: { appid: Number(value) } }];
          const result = await api('/sources', { proposals });
          setState((prev) => (prev ? { ...prev, sources: result.sources } : prev));
          flashWith('已添加');
        },
        [flashWith],
      );

      const testSource = useCallback(
        async (source) => {
          try {
            const result = await api('/source/test', { id: source.id }, 120000);
            const count = Array.isArray(result.items) ? result.items.length : Number(result.items || 0);
            if (result.ok && (count > 0 || result.status === 'ok')) {
              flashWith(`${source.label || '来源'}：${count > 0 ? `抓到 ${count} 条` : '正常，暂无新内容'}`);
            } else {
              flashWith(`${source.label || '来源'}：${result.note || '没抓到内容，检查地址或登录信息'}`, 'err');
            }
          } catch (err) {
            flashWith(err.message || String(err), 'err');
          }
        },
        [flashWith],
      );

      const toggleSource = useCallback(
        async (source, enabled) => {
          if (staleRef.current) {
            flashWith('先重启一次 DSH，再修改来源', 'err');
            return;
          }
          try {
            const result = await api('/source/update', { id: source.id, patch: { enabled } });
            setState((prev) => (prev ? { ...prev, sources: result.sources } : prev));
          } catch (err) {
            flashWith(err.message || String(err), 'err');
          }
        },
        [flashWith],
      );

      const saveSecret = useCallback(
        async (source, field, raw) => {
          const value = String(raw || '').trim();
          if (value === '') throw new Error(field === 'headers' ? '先粘贴 Cookie' : '先填密码');
          if (staleRef.current) throw new Error('先重启一次 DSH，再保存登录信息');
          const payload = field === 'headers' && !value.startsWith('{') ? JSON.stringify({ cookie: value }) : value;
          await api('/secret', { sourceId: source.id, field, value: payload });
          const next = await api('/state');
          setState(next);
          flashWith(field === 'headers' ? `${source.label || '来源'}：Cookie 已保存` : `${source.label || '来源'}：密码已保存`);
        },
        [flashWith],
      );

      const removeSource = useCallback(
        async (id) => {
          if (staleRef.current) {
            flashWith('先重启一次 DSH，再修改关注范围', 'err');
            return;
          }
          try {
            const result = await api('/source/remove', { id });
            setState((prev) => (prev ? { ...prev, sources: result.sources } : prev));
            flashWith('已移除');
          } catch (err) {
            flashWith(err.message || String(err), 'err');
          }
        },
        [flashWith],
      );

      const openFolder = useCallback(
        async (which) => {
          try {
            const result = await api('/open', { which });
            if (!result.ok) throw new Error(result.error || '打不开');
          } catch (err) {
            flashWith(err.message || String(err), 'err');
          }
        },
        [flashWith],
      );

      if (error && !state) return h('div', { className: 'dbp-root' }, h('div', { className: 'dbp-error' }, `加载失败：${error}`));

      if (!state) {
        return h(
          'div',
          { className: 'dbp-root' },
          h(
            'div',
            { className: 'dbp-page' },
            h('div', { className: 'dbp-skel', style: { width: '32%' } }),
            h('div', { className: 'dbp-skel', style: { width: '68%', height: 22 } }),
            h('div', { className: 'dbp-skel', style: { width: '90%' } }),
            h('div', { className: 'dbp-skel', style: { width: '84%' } }),
            h('div', { className: 'dbp-skel', style: { width: '76%' } }),
          ),
        );
      }

      const config = state.config || {};
      const briefing = state.latest ? state.latest.data : null;
      const briefings = Array.isArray(state.briefings) ? state.briefings : [];
      const schedule = config.schedule || {};
      const task = state.schedule && state.schedule.task ? state.schedule.task : null;
      const sub = [schedule.enabled !== false ? `每天 ${schedule.time || '07:30'}` : '已暂停', config.timezone].filter(Boolean).join(' · ');

      return h(
        'div',
        { className: 'dbp-root' },
        h(
          'div',
          { className: 'dbp-page' },
          h(
            'div',
            { className: 'dbp-head' },
            h(PanelIcon, null),
            h('h1', null, '每日简报'),
            h('span', { className: 'dbp-sub' }, sub),
            h(
              'div',
              { className: 'dbp-head-actions' },
              h(Btn, { onClick: () => setAddOpen(true), disabled: stale }, '添加来源'),
              h(Btn, { onClick: () => popup('latest'), disabled: !briefing }, '弹窗'),
              h(Btn, { variant: 'primary', onClick: generate, disabled: busy !== '' }, busy ? '生成中…' : '立即生成'),
            ),
          ),
          h(TodayCard, {
            briefing,
            busy: busy === 'run',
            onGenerate: generate,
            onPopup: () => popup('latest'),
          }),
          stale
            ? h(
                'div',
                { className: 'dbp-note' },
                '面板已是新版，但 DSH 主进程还停在旧版插件：重启一次 DSH 后，人设卡片、IP/监控页来源和桌面弹窗才会真正生效。',
              )
            : null,
          h(
            'div',
            { className: 'dbp-grid' },
            h(StyleCard, { config, onSave: (patch) => saveDebounced(patch), locked: stale }),
            h(RhythmCard, {
              config,
              onSave: (patch) => saveDebounced(patch),
              onTestPopup: async () => {
                if (staleRef.current) {
                  flashWith('先重启一次 DSH，桌面弹窗才能启用', 'err');
                  return;
                }
                try {
                  const result = await api('/popup', {}, 30000);
                  if (!result.ok) throw new Error(result.error || '打不开窗口');
                  flashWith(result.mode === 'app' ? '弹窗已出现' : result.message || '已打开');
                } catch (err) {
                  flashWith(err.message || String(err), 'err');
                }
              },
            }),
          ),
          h(FocusCard, {
            sources: state.sources || [],
            onAdd: addSource,
            onRemove: removeSource,
            locked: stale,
            onPickSteam: caps.includes('steamlib') ? () => setSteamOpen(true) : null,
          }),
          h(
            'div',
            { className: 'dbp-grid' },
            h(SourcesCard, {
              sources: state.sources || [],
              secrets: state.secrets,
              locked: stale,
              onAdd: () => setAddOpen(true),
              onTest: testSource,
              onToggle: toggleSource,
              onRemove: removeSource,
              onSecret: saveSecret,
            }),
            h(HistoryCard, { briefings, onOpen: popup }),
          ),
          h(AdvancedCard, { state, onOpenFolder: openFolder, onSave: (patch) => save(patch, { quiet: true }) }),
          task && task.installed === false && schedule.enabled !== false
            ? h('div', { className: 'dbp-warn' }, '计划任务尚未安装，保存一次时间设置即可重试。')
            : null,
          addOpen
            ? h(AddSourceDialog, {
                locked: stale,
                onClose: () => setAddOpen(false),
                onAdded: (count) => {
                  flashWith(`已添加 ${count} 个来源`);
                  refresh();
                },
              })
            : null,
          steamOpen
            ? h(SteamPicker, {
                onClose: () => setSteamOpen(false),
                onAdded: (count) => {
                  setSteamOpen(false);
                  flashWith(`已从 Steam 库添加 ${count} 个游戏`);
                  refresh();
                },
              })
            : null,
          flash ? h('div', { className: `dbp-flash${flash.kind === 'err' ? ' err' : ''}` }, flash.text) : null,
        ),
      );
    }

    function Boundary(props) {
      const [failure, setFailure] = useState(null);
      useEffect(() => {
        const onError = (event) => setFailure(event.error || new Error('unknown'));
        window.addEventListener('error', onError);
        return () => window.removeEventListener('error', onError);
      }, []);
      if (failure) return h('div', { className: 'dbp-error' }, `面板出错了：${failure.message || failure}`);
      return props.children;
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.panellist', () => {
          const offRow = ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => '每日简报' },
            PanelIcon,
          );
          const offPanel = ctx.slots.register(
            { name: 'main', key: PANEL_ID },
            () => h(Boundary, null, h(App, null)),
          );
          return () => {
            try {
              offRow?.();
            } catch {
              /* ignore */
            }
            try {
              offPanel?.();
            } catch {
              /* ignore */
            }
          };
        });
      },
    };
  },
});

