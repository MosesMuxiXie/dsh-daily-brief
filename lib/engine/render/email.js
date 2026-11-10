/**
 * Email delivery: a compact, table-based HTML mail that still feels designed,
 * plus a plain-text alternative.
 */
import { escapeHtml } from '../text.js';

function esc(value) {
  return escapeHtml(String(value ?? ''));
}

function safeUrl(value) {
  const text = String(value ?? '');
  return /^https?:\/\//i.test(text) ? esc(text) : '';
}

const ACCENTS = {
  mail: '#b4553f',
  managebac: '#3f6d8e',
  tasks: '#5c7a3f',
  calendar: '#86603d',
  aiNews: '#5b5b96',
  gameNews: '#8a4d6d',
  server: '#3f7a6b',
  browser: '#6b6656',
  custom: '#7a6a52',
};

function sectionRow(section) {
  const accent = ACCENTS[section.id] ?? '#7a6a52';
  const digest = String(section.digest || '').trim();
  const points = Array.isArray(section.points) ? section.points.filter((entry) => String(entry || '').trim() !== '') : [];
  const folded = digest !== '' || points.length > 0;
  const items = folded
    ? []
    : section.items.map((item) => {
        const url = safeUrl(item.url);
        const title = url
          ? `<a href="${url}" style="color:#23211c;text-decoration:none">${esc(item.title)}</a>`
          : esc(item.title);
        const meta = [item.meta, item.badge].filter(Boolean).map(esc).join(' · ');
        return `<tr><td style="padding:10px 0;border-top:1px solid #ece7dc">
      <div style="font-size:14px;line-height:1.5;color:#23211c;font-weight:600">${title}</div>
      ${meta ? `<div style="font-size:11px;color:#8a8377;margin-top:2px">${meta}</div>` : ''}
      ${item.detail ? `<div style="font-size:12.5px;color:#57534a;line-height:1.6;margin-top:3px">${esc(item.detail)}</div>` : ''}
    </td></tr>`;
      });
  const digestBlock = digest
    ? `<div style="font-size:13.5px;line-height:1.85;color:#3d382f;padding:6px 0 2px">${esc(digest)}</div>`
    : '';
  const pointsBlock = points.length > 0
    ? `<div style="padding:8px 0 2px">${points
        .map(
          (entry) =>
            `<div style="font-size:13.5px;line-height:1.75;color:#3d382f;padding-left:14px;position:relative">• ${esc(entry)}</div>`,
        )
        .join('')}</div>`
    : '';
  return `<tr><td style="padding:22px 26px 4px">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr><td style="width:4px;background:${accent};border-radius:2px"></td>
      <td style="padding-left:12px">
        <div style="font-size:16px;font-weight:700;color:#23211c">${esc(section.zh)}</div>
        <div style="font-size:11px;color:#8a8377;margin-top:1px">${esc(section.summary)}</div>
      </td></tr>
    </table>
    ${digestBlock}
    ${pointsBlock}
    ${items.length > 0 ? `<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:6px">${items.join('')}</table>` : ''}
  </td></tr>`;
}

export function renderBriefingEmail(briefing) {
  const subject = `${briefing.dateLabel} · 每日简报`;
  const chips = briefing.chips
    .map(
      (chip) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border:1px solid #e6dfd2;border-radius:999px;font-size:11px;color:#57534a">${esc(
          chip.label,
        )} ${chip.count}</span>`,
    )
    .join('');
  const warnings =
    briefing.warnings.length > 0
      ? `<tr><td style="padding:12px 26px 0"><div style="padding:10px 14px;border-radius:10px;background:#fbf3e4;color:#8a641f;font-size:12px">需要留意：${briefing.warnings
          .map(esc)
          .join('；')}</div></td></tr>`
      : '';
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f2eee6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(briefing.headline)}</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#f2eee6;padding:26px 0">
<tr><td align="center">
<table width="640" cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:640px;background:#fffdf8;border-radius:18px;overflow:hidden;border:1px solid #e7e0d3">
  <tr><td style="padding:26px 26px 0">
    <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:#9a9284">Daily Brief · ${esc(briefing.persona.name)}</div>
    <div style="font-family:Georgia,'Songti SC',serif;font-size:25px;line-height:1.35;color:#23211c;margin-top:10px">${esc(briefing.greeting)}</div>
    <div style="font-size:13px;line-height:1.7;color:#57534a;margin-top:6px">${esc(briefing.headline)}</div>
    <div style="margin-top:14px">${chips}</div>
  </td></tr>
  <tr><td style="padding:14px 26px 0"><div style="height:1px;background:#ece7dc"></div></td></tr>
  ${warnings}
  ${briefing.sections.map(sectionRow).join('')}
  <tr><td style="padding:20px 26px 26px">
    <div style="height:1px;background:#ece7dc;margin-bottom:14px"></div>
    <div style="font-size:11px;color:#9a9284;line-height:1.7">由 DSH 每日简报生成 · ${esc(briefing.dateLabel)} ${esc(briefing.timeLabel)} · 数据仅保存在本机</div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
  return { subject, html, text: renderBriefingText(briefing) };
}

export function renderBriefingText(briefing) {
  const lines = [`${briefing.dateLabel} · 每日简报`, '', briefing.greeting, briefing.headline, ''];
  for (const section of briefing.sections) {
    lines.push(`【${section.zh}】${section.summary}`);
    const digest = String(section.digest || '').trim();
    const points = Array.isArray(section.points) ? section.points.filter((entry) => String(entry || '').trim() !== '') : [];
    if (digest) {
      lines.push(digest, '');
      continue;
    }
    if (points.length > 0) {
      for (const entry of points) lines.push(`· ${entry}`);
      lines.push('');
      continue;
    }
    for (const item of section.items) {
      const meta = [item.meta, item.badge].filter(Boolean).join(' · ');
      lines.push(`- ${item.title}${meta ? `（${meta}）` : ''}`);
      if (item.url) lines.push(`  ${item.url}`);
    }
    lines.push('');
  }
  if (briefing.warnings.length > 0) lines.push(`需要留意：${briefing.warnings.join('；')}`, '');
  lines.push('由 DSH 每日简报生成，数据仅保存在本机。');
  return lines.join('\n');
}
