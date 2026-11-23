/**
 * The little card for the stop the sprouts stand on: its name and subtitle, the fireflies found, the
 * best time, a run to continue — or the boss, or the storybook at a gate. Plain HTML: the preview page
 * shows it now, a menu screen will later.
 */
import type { NodeInfo } from './map';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const time = (s: number) => `${Math.floor(s / 60)}:${Math.floor(s % 60)
  .toString()
  .padStart(2, '0')}`;

/**
 * The card's HTML. `act`: what its last line offers (a button with data-act, or plain words when `act`
 * is empty; null for nothing) — by default it says what Ⓐ does.
 */
export function cardHtml(i: NodeInfo, act?: { act: string; label: string } | null): string {
  const head = `<div class="ow-world">World ${i.worldNo} · ${esc(i.world)}</div>`;
  const name = `<div class="ow-name">${esc(i.name)}</div>`;
  const sub = i.subtitle ? `<div class="ow-sub">${esc(i.subtitle)}</div>` : '';
  const lines: string[] = [];
  if (i.boss) lines.push(`<div class="ow-boss"><b>${esc(i.boss.name)}</b> · ${esc(i.boss.line)}</div>`);
  if (i.playable && i.kind !== 'side') {
    const dots = [0, 1, 2].map((k) => `<i class="${k < i.fireflies ? 'on' : ''}"></i>`).join('');
    const best = i.best > 0 ? `<span>best ${time(i.best)}</span>` : '';
    lines.push(`<div class="ow-stats"><span class="ow-ff">${dots} ${i.fireflies}/3</span>${best}</div>`);
  }
  if (i.lantern !== null && i.playable) lines.push(`<div class="ow-run">continue from ${i.lantern < 0 ? 'the start' : `lantern ${i.lantern + 1}`}${i.with ? ` · with ${esc(i.with)}` : ''}</div>`);
  let line = '';
  if (i.state === 'soon') line = '<div class="ow-act soon">coming soon</div>';
  else if (act) line = `<div class="ow-act"${act.act ? ` data-act="${act.act}"` : ''}>${act.label}</div>`;
  else if (act === undefined) {
    const say = i.kind === 'gate' ? (i.story ? 'Ⓐ read the story' : '') : !i.playable ? '' : i.lantern !== null ? 'Ⓐ continue' : i.state === 'cleared' ? 'Ⓐ play again' : 'Ⓐ play';
    if (say) line = `<div class="ow-act">${say}</div>`;
  }
  return `${head}${name}${sub}${lines.join('')}${line}`;
}

/** The card's look (the game's own: a dark card, cream text, gold for what matters). */
export const CARD_CSS = `
.ow-card { position: fixed; left: max(12px, env(safe-area-inset-left)); bottom: max(12px, env(safe-area-inset-bottom)); min-width: min(220px, 40vw); max-width: min(30em, 70vw);
  padding: 10px 16px 12px; border-radius: 16px; background: rgba(29, 27, 56, 0.86); color: #fff8ea; font-family: 'Fredoka', system-ui, sans-serif;
  font-size: clamp(12px, 2.1vh, 24px); line-height: 1.25; box-shadow: 0 6px 24px rgba(0,0,0,0.25); transition: opacity 0.15s, transform 0.15s; pointer-events: auto; }
.ow-card.hide { opacity: 0; transform: translateY(8px); pointer-events: none; }
.ow-world { color: #ffd27a; font-weight: 600; font-size: max(11px, 0.72em); letter-spacing: 0.08em; text-transform: uppercase; }
.ow-name { font-weight: 600; font-size: 1.35em; }
.ow-sub { opacity: 0.8; font-size: max(11px, 0.85em); }
.ow-boss { margin-top: 4px; font-size: max(11px, 0.85em); } .ow-boss b { color: #ff9dbb; font-weight: 600; }
.ow-stats { display: flex; gap: 14px; margin-top: 6px; font-size: max(11px, 0.85em); align-items: center; }
.ow-ff i { display: inline-block; width: 0.62em; height: 0.62em; border-radius: 50%; margin-right: 3px; background: rgba(255,255,255,0.18); vertical-align: middle; }
.ow-ff i.on { background: #ecff9c; box-shadow: 0 0 8px 2px rgba(226,255,120,0.7); }
.ow-run { margin-top: 4px; font-size: max(11px, 0.85em); color: #ffd27a; }
.ow-act { margin-top: 8px; font-weight: 600; color: #ffd27a; } .ow-act.soon { color: #fff8ea; opacity: 0.6; font-weight: 400; }
`;
