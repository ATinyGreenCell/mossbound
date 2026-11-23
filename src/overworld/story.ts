/**
 * The storybook card at a world's gate: a picture painted in the map's style (the world's boss, or a
 * landmark), the world's name, and its page of story with the players' own names in it.
 */
import type { BossArt, WorldDef } from '../game/worlds';
import { portrait } from './bosses';
import { drawMark } from './decor';
import { mapTheme } from './themes';

const BOSSES: readonly string[] = ['snip', 'rummage', 'jangle'];

/** The story's text, {1} and {2} filled in with the players' names (Pip and Bo, if they haven't said). */
export function storyText(def: WorldDef, names: [string, string]): string[] {
  const [a, b] = [names[0] || 'Pip', names[1] || 'Bo'];
  return (def.story ?? []).map((p) => p.replace(/\{1\}/g, a).replace(/\{2\}/g, b));
}

/**
 * Paint the card's picture into `c` (its CSS size × `dpr`): a wash of the world's meadow and sky, an
 * inked frame, and the picture in the middle.
 */
export function paintStory(c: HTMLCanvasElement, def: WorldDef, cssW: number, cssH: number, dpr: number) {
  c.width = Math.round(cssW * dpr);
  c.height = Math.round(cssH * dpr);
  c.style.width = `${cssW}px`;
  c.style.height = `${cssH}px`;
  const g = c.getContext('2d')!;
  const th = mapTheme(def.mapTheme);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // sky above, the meadow below, the creek between
  const sky = g.createLinearGradient(0, 0, 0, cssH);
  sky.addColorStop(0, th.grade[th.grade.length - 1]);
  sky.addColorStop(0.55, th.grade[0]);
  sky.addColorStop(0.56, th.ground[2]);
  sky.addColorStop(1, th.ground[0]);
  g.fillStyle = sky;
  g.fillRect(0, 0, cssW, cssH);
  g.fillStyle = th.water[1];
  g.beginPath();
  g.moveTo(0, cssH * 0.72);
  g.quadraticCurveTo(cssW * 0.35, cssH * 0.62, cssW * 0.6, cssH * 0.74);
  g.quadraticCurveTo(cssW * 0.8, cssH * 0.84, cssW, cssH * 0.76);
  g.lineTo(cssW, cssH * 0.86);
  g.quadraticCurveTo(cssW * 0.75, cssH * 0.94, cssW * 0.55, cssH * 0.84);
  g.quadraticCurveTo(cssW * 0.3, cssH * 0.74, 0, cssH * 0.82);
  g.closePath();
  g.fill();
  g.strokeStyle = th.ink;
  g.lineWidth = 1.4;
  g.stroke();
  // the picture: a boss, or a landmark
  const art = def.storyArt ?? def.boss?.art ?? '';
  if (BOSSES.includes(art)) {
    const p = portrait(art as BossArt, dpr * 1.25, false);
    const s = Math.min((cssH * 0.82) / p.h, (cssW * 0.6) / p.w);
    const w = p.w * s;
    const h = p.h * s;
    g.drawImage(p.c, cssW / 2 - w / 2, cssH * 0.86 - h, w, h);
  } else if (art) {
    g.save();
    g.translate(cssW / 2, cssH * 0.84);
    g.scale(1.05, 1.05);
    drawMark(g, art, 0, 0, -1, th, [], 7);
    g.restore();
  }
  // an inked frame
  g.strokeStyle = th.ink;
  g.lineWidth = 3;
  g.beginPath();
  g.roundRect(1.5, 1.5, cssW - 3, cssH - 3, 12);
  g.stroke();
}
