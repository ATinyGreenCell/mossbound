/**
 * The things on the map, drawn in the game's style: ink outlines like the sprouts', flat fills, a
 * lighter top and a darker side, seen from above at a slight tilt (a thing's (x, y) is where it meets
 * the ground; it stands up from there). Everything here is painted into the map's chunks (paint.ts),
 * never per frame, so it can afford a few more paths than a sprite would.
 */
import type { MapTheme } from './themes';
import type { Item } from './scatter';
import { K } from './scatter';

type G = CanvasRenderingContext2D;
const TAU = Math.PI * 2;
/** outline widths, map units (a sprout's is about 1 at map scale) */
export const LW = 1.3;
const LW_S = 0.95;

export function ell(g: G, x: number, y: number, rx: number, ry: number) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, TAU);
}

function fillInk(g: G, fill: string, ink: string, lw = LW) {
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = ink;
  g.stroke();
}

/** A lumpy closed shape round (x, y): `n` points, their radii varied by a and b. */
function blob(g: G, x: number, y: number, rx: number, ry: number, a: number, b: number, n = 6) {
  g.beginPath();
  const px: number[] = [];
  const py: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * TAU + a * 2;
    const k = 0.82 + 0.3 * ((Math.sin(i * 2.3 + b * 9) + 1) / 2);
    px.push(x + Math.cos(t) * rx * k);
    py.push(y + Math.sin(t) * ry * k);
  }
  g.moveTo((px[n - 1] + px[0]) / 2, (py[n - 1] + py[0]) / 2);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    g.quadraticCurveTo(px[i], py[i], (px[i] + px[j]) / 2, (py[i] + py[j]) / 2);
  }
  g.closePath();
}

function shadow(g: G, x: number, y: number, rx: number, ry: number) {
  g.fillStyle = 'rgba(30,50,20,0.16)';
  ell(g, x, y, rx, ry);
  g.fill();
}

/** Circles, outlined as one shape: ink under all of them, then the fills over the inner lines (each pass one path). */
function puff(g: G, C: number[][], fill: string, dark: string, light: string | null, ink: string) {
  g.beginPath();
  for (const [x, y, r] of C) {
    g.moveTo(x + r, y);
    g.ellipse(x, y, r, r, 0, 0, TAU);
  }
  g.lineWidth = LW * 2;
  g.strokeStyle = ink;
  g.stroke();
  g.fillStyle = dark;
  g.fill();
  g.beginPath();
  for (const [x, y, r] of C) {
    g.moveTo(x - r * 0.07 + r * 0.9, y - r * 0.14);
    g.ellipse(x - r * 0.07, y - r * 0.14, r * 0.9, r * 0.88, 0, 0, TAU);
  }
  g.fillStyle = fill;
  g.fill();
  if (light) {
    g.fillStyle = light;
    const [x, y, r] = C[2] ?? C[0];
    ell(g, x - r * 0.3, y - r * 0.38, r * 0.34, r * 0.24);
    g.fill();
  }
}

function tree(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a } = it;
  shadow(g, x + s * 0.15, y + s * 0.05, s * 0.95, s * 0.3);
  const tw = s * 0.15;
  g.beginPath();
  g.moveTo(x - tw * 1.2, y + 1);
  g.lineTo(x - tw * 0.75, y - s * 0.75);
  g.lineTo(x + tw * 0.75, y - s * 0.75);
  g.lineTo(x + tw * 1.2, y + 1);
  g.closePath();
  fillInk(g, th.trunk, th.ink);
  const cy = y - s * 1.3;
  const v = (a - 0.5) * 0.2;
  puff(
    g,
    [
      [x - s * (0.5 + v), cy + s * 0.16, s * 0.56],
      [x + s * (0.5 - v), cy + s * 0.18, s * 0.54],
      [x + s * v, cy - s * 0.3, s * 0.64],
      [x, cy + s * 0.3, s * 0.58],
    ],
    th.leaf[Math.floor(it.c * th.leaf.length)],
    th.leafDark,
    th.leafLight,
    th.ink,
  );
}

function pine(g: G, it: Item, th: MapTheme) {
  const { x, y, s } = it;
  shadow(g, x + s * 0.2, y + s * 0.04, s * 0.75, s * 0.26);
  g.fillStyle = th.trunk;
  g.beginPath();
  g.rect(x - s * 0.1, y - s * 0.45, s * 0.2, s * 0.47);
  g.fill();
  g.lineWidth = LW_S;
  g.strokeStyle = th.ink;
  g.stroke();
  const col = th.pine[Math.floor(it.c * th.pine.length)];
  for (let i = 0; i < 3; i++) {
    const by = y - s * (0.32 + i * 0.58);
    const hw = s * (0.82 - i * 0.2);
    const h = s * 0.95;
    g.beginPath();
    g.moveTo(x - hw, by);
    g.quadraticCurveTo(x, by + s * 0.16, x + hw, by);
    g.lineTo(x, by - h);
    g.closePath();
    fillInk(g, col, th.ink);
    g.fillStyle = 'rgba(255,255,255,0.16)';
    g.beginPath();
    g.moveTo(x - hw * 0.8, by - 1);
    g.lineTo(x, by - h + 2);
    g.lineTo(x - hw * 0.1, by + 1);
    g.closePath();
    g.fill();
  }
}

function bush(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a } = it;
  shadow(g, x + s * 0.1, y + s * 0.1, s * 1.05, s * 0.32);
  const cy = y - s * 0.5;
  puff(
    g,
    [
      [x - s * 0.5, cy + s * 0.1, s * 0.55],
      [x + s * 0.5, cy + s * 0.12, s * 0.5],
      [x + (a - 0.5) * s * 0.3, cy - s * 0.2, s * 0.62],
    ],
    th.leaf[Math.floor(it.c * th.leaf.length)],
    th.leafDark,
    th.leafLight,
    th.ink,
  );
  if (it.b > 0.6) {
    g.fillStyle = th.flowers[Math.floor(it.b * 7) % th.flowers.length];
    for (let i = 0; i < 3; i++) {
      ell(g, x + (i - 1) * s * 0.45, cy - s * 0.1 + (i % 2) * s * 0.2, 1.4, 1.4);
      g.fill();
    }
  }
}

function rock(g: G, it: Item, th: MapTheme, big = false) {
  const { x, y, s, a, b } = it;
  shadow(g, x + s * 0.2, y + s * 0.15, s * 1.1, s * 0.35);
  blob(g, x, y - s * 0.35, s, s * 0.72, a, b);
  fillInk(g, th.stone[0], th.ink, big ? LW : LW_S);
  blob(g, x - s * 0.12, y - s * 0.6, s * 0.62, s * 0.38, a + 0.3, b);
  g.fillStyle = th.stone[1];
  g.fill();
  if (big) {
    // a cap of moss
    blob(g, x - s * 0.15, y - s * 0.82, s * 0.6, s * 0.28, b, a, 5);
    fillInk(g, th.path.moss, th.ink, LW_S);
  }
}

function fern(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a } = it;
  const col = th.leaf[Math.floor(it.c * th.leaf.length)];
  g.lineWidth = LW_S;
  for (let i = 0; i < 5; i++) {
    const ang = -Math.PI / 2 + (i - 2) * 0.48 + (a - 0.5) * 0.3;
    const len = s * (1.25 - Math.abs(i - 2) * 0.16);
    g.save();
    g.translate(x, y);
    g.rotate(ang);
    g.beginPath();
    g.moveTo(0, 0);
    g.quadraticCurveTo(len * 0.5, -s * 0.24, len, 0);
    g.quadraticCurveTo(len * 0.5, s * 0.24, 0, 0);
    fillInk(g, col, th.ink, LW_S);
    g.strokeStyle = th.leafDark;
    g.beginPath();
    g.moveTo(1, 0);
    g.lineTo(len * 0.85, 0);
    g.stroke();
    g.restore();
  }
}

function flowers(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a, b } = it;
  const n = 4 + Math.floor(a * 3);
  for (let i = 0; i < n; i++) {
    const t = i * 2.4 + b * 6;
    const fx = x + Math.cos(t) * s * (0.3 + 0.6 * ((i * 0.37 + a) % 1));
    const fy = y + Math.sin(t) * s * 0.45;
    g.fillStyle = th.leafDark;
    ell(g, fx + 1.2, fy + 1.2, 1.3, 0.8);
    g.fill();
    g.fillStyle = th.flowers[(i + Math.floor(it.c * 4)) % th.flowers.length];
    ell(g, fx, fy, 1.9, 1.7);
    g.fill();
    g.fillStyle = '#ffe680';
    ell(g, fx, fy, 0.65, 0.65);
    g.fill();
  }
}

function tuft(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a } = it;
  g.strokeStyle = th.specks[Math.floor(it.c * 2) % th.specks.length];
  g.lineWidth = 1.2;
  g.lineCap = 'round';
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const bx = x + (i - 1.5) * 1.8;
    g.moveTo(bx, y);
    g.quadraticCurveTo(bx + (i - 1.5) * 0.8, y - s * 0.6, bx + (i - 1.5) * 1.6 + (a - 0.5) * 2, y - s * (0.9 + ((i * 0.3 + a) % 0.5)));
  }
  g.stroke();
}

function reeds(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a } = it;
  g.lineCap = 'round';
  for (let i = 0; i < 4; i++) {
    const bx = x + (i - 1.5) * 2.6;
    const h = s * (1.7 + ((i * 0.41 + a) % 0.6));
    const lean = (i - 1.5) * 1.2 + (a - 0.5) * 3;
    g.strokeStyle = th.leafDark;
    g.lineWidth = 1.3;
    g.beginPath();
    g.moveTo(bx, y);
    g.quadraticCurveTo(bx, y - h * 0.6, bx + lean, y - h);
    g.stroke();
    if (i % 2 === 0) {
      g.beginPath();
      g.roundRect(bx + lean * 0.9 - 1.5, y - h * 0.92, 3, 6.5, 1.5);
      fillInk(g, '#8a5d36', th.ink, 0.7);
    }
  }
}

function mushroom(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a } = it;
  for (let i = 0; i < 2; i++) {
    const mx = x + i * s * 1.1 - s * 0.4;
    const ms = s * (i ? 0.75 : 1);
    g.beginPath();
    g.rect(mx - ms * 0.28, y - ms * 1.1, ms * 0.56, ms * 1.1);
    fillInk(g, '#f2e6cf', th.ink, LW_S);
    g.beginPath();
    g.ellipse(mx, y - ms * 1.1, ms, ms * 0.72, 0, Math.PI, TAU);
    g.closePath();
    fillInk(g, a < 0.5 ? '#d9604c' : '#b98a52', th.ink, LW_S);
    g.fillStyle = '#fff4e4';
    ell(g, mx - ms * 0.35, y - ms * 1.45, ms * 0.16, ms * 0.12);
    g.fill();
    ell(g, mx + ms * 0.25, y - ms * 1.35, ms * 0.13, ms * 0.1);
    g.fill();
  }
}

function stump(g: G, it: Item, th: MapTheme) {
  const { x, y, s } = it;
  shadow(g, x + s * 0.3, y + s * 0.1, s * 1.2, s * 0.35);
  g.beginPath();
  g.moveTo(x - s, y - s * 0.9);
  g.lineTo(x - s * 1.05, y);
  g.quadraticCurveTo(x, y + s * 0.45, x + s * 1.05, y);
  g.lineTo(x + s, y - s * 0.9);
  g.closePath();
  fillInk(g, th.trunk, th.ink);
  ell(g, x, y - s * 0.9, s, s * 0.42);
  fillInk(g, '#dcbd8c', th.ink);
  g.strokeStyle = '#b8946a';
  g.lineWidth = 0.7;
  ell(g, x, y - s * 0.9, s * 0.55, s * 0.22);
  g.stroke();
}

function lily(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a, b } = it;
  g.beginPath();
  g.moveTo(x, y);
  g.ellipse(x, y, s, s * 0.62, 0, a * TAU + 0.3, a * TAU + TAU - 0.3);
  g.closePath();
  fillInk(g, '#78b44c', '#3f6f2a', 0.8);
  if (b > 0.62) {
    g.fillStyle = '#ffb6cc';
    for (let i = 0; i < 5; i++) {
      const t = (i / 5) * TAU;
      ell(g, x + Math.cos(t) * 1.6, y - 1 + Math.sin(t) * 1, 1.5, 1.1);
      g.fill();
    }
    g.fillStyle = '#ffe680';
    ell(g, x, y - 1, 0.9, 0.7);
    g.fill();
  }
  void th;
}

function wetrock(g: G, it: Item, th: MapTheme) {
  const { x, y, s, a, b } = it;
  g.strokeStyle = th.water[2];
  g.lineWidth = 1;
  g.globalAlpha = 0.8;
  ell(g, x, y + s * 0.1, s * 1.45, s * 0.55);
  g.stroke();
  g.globalAlpha = 1;
  blob(g, x, y - s * 0.2, s, s * 0.62, a, b, 5);
  fillInk(g, th.stone[0], th.ink, LW_S);
  blob(g, x - s * 0.15, y - s * 0.42, s * 0.55, s * 0.3, b, a, 5);
  g.fillStyle = th.stone[1];
  g.fill();
}

function foam(g: G, it: Item, th: MapTheme) {
  const { x, y, s } = it;
  g.strokeStyle = th.water[2];
  g.lineCap = 'round';
  g.lineWidth = 1.6;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const ox = x + (i - 1) * s * 0.7;
    g.moveTo(ox - s * 0.4, y + (i % 2) * 2.5);
    g.quadraticCurveTo(ox, y - 2.5 + (i % 2) * 2.5, ox + s * 0.4, y + (i % 2) * 2.5);
  }
  g.stroke();
}

/** Draw one item (not a landmark: see drawMark). */
export function drawItem(g: G, it: Item, th: MapTheme) {
  switch (it.k) {
    case K.tree:
      return tree(g, it, th);
    case K.pine:
      return pine(g, it, th);
    case K.bush:
      return bush(g, it, th);
    case K.rock:
      return rock(g, it, th);
    case K.boulder:
      return rock(g, it, th, true);
    case K.fern:
      return fern(g, it, th);
    case K.flowers:
      return flowers(g, it, th);
    case K.tuft:
      return tuft(g, it, th);
    case K.reeds:
      return reeds(g, it, th);
    case K.mushroom:
      return mushroom(g, it, th);
    case K.stump:
      return stump(g, it, th);
    case K.lily:
      return lily(g, it, th);
    case K.wetrock:
      return wetrock(g, it, th);
    case K.foam:
      return foam(g, it, th);
  }
}

// ------------------------------------------------------------------ landmarks

/** Windows and glows to light at night, gathered while landmarks are drawn: [x, y, w, h]. */
export type Lights = number[];

function windowAt(g: G, x: number, y: number, w: number, h: number, ink: string, lights: Lights) {
  g.beginPath();
  g.rect(x, y, w, h);
  fillInk(g, '#4a5a6a', ink, LW_S);
  g.strokeStyle = ink;
  g.lineWidth = 0.7;
  g.beginPath();
  g.moveTo(x + w / 2, y);
  g.lineTo(x + w / 2, y + h);
  g.moveTo(x, y + h / 2);
  g.lineTo(x + w, y + h / 2);
  g.stroke();
  lights.push(x, y, w, h);
}

function home(g: G, x: number, y: number, th: MapTheme) {
  // a little picket fence behind, the pot the seed was saved in (empty now), a watering can
  g.lineWidth = LW_S;
  for (let i = 0; i < 7; i++) {
    const px = x - 44 + i * 13;
    const py = y - 26 - Math.sin((i / 6) * Math.PI) * 6;
    g.beginPath();
    g.moveTo(px - 3, py + 14);
    g.lineTo(px - 3, py);
    g.lineTo(px, py - 4);
    g.lineTo(px + 3, py);
    g.lineTo(px + 3, py + 14);
    g.closePath();
    fillInk(g, '#f4ead2', th.ink, LW_S);
  }
  g.strokeStyle = th.ink;
  g.beginPath();
  g.moveTo(x - 50, y - 20);
  g.quadraticCurveTo(x - 4, y - 34, x + 42, y - 20);
  g.stroke();
  shadow(g, x + 4, y + 2, 20, 6);
  // the pot
  g.beginPath();
  g.moveTo(x - 12, y - 18);
  g.lineTo(x - 9, y);
  g.lineTo(x + 9, y);
  g.lineTo(x + 12, y - 18);
  g.closePath();
  fillInk(g, '#d9794e', th.ink);
  g.beginPath();
  g.rect(x - 14, y - 22, 28, 6);
  fillInk(g, '#e8915f', th.ink);
  ell(g, x, y - 22, 12, 3.2);
  fillInk(g, '#5c3f2a', th.ink, LW_S);
  // where the seed was
  ell(g, x + 1, y - 22, 2.4, 1);
  g.fillStyle = '#3a271a';
  g.fill();
  // the watering can
  g.beginPath();
  g.roundRect(x + 18, y - 12, 14, 11, 2.5);
  fillInk(g, '#7fb0c8', th.ink, LW_S);
  g.beginPath();
  g.moveTo(x + 31, y - 7);
  g.lineTo(x + 40, y - 15);
  g.lineWidth = 2.6;
  g.strokeStyle = th.ink;
  g.stroke();
  g.lineWidth = 1.2;
  g.strokeStyle = '#7fb0c8';
  g.stroke();
  // flowers along the fence
  g.fillStyle = th.flowers[2 % th.flowers.length];
  for (const [fx, fy] of [
    [-34, -10],
    [-24, -6],
    [26, -22],
    [-40, -4],
  ]) {
    ell(g, x + fx, y + fy, 2, 1.8);
    g.fill();
  }
}

function mill(g: G, x: number, y: number, side: number, th: MapTheme, lights: Lights) {
  // the mill on the far bank (north: up the screen), its wheel turning in the race below it
  const bx = x + 34;
  const by = y + side * 16;
  shadow(g, bx + 6, by + 4, 50, 12);
  // stone footing, walls, timber
  g.beginPath();
  g.rect(bx - 42, by - 16, 84, 16);
  fillInk(g, '#9a9488', th.ink);
  g.strokeStyle = '#7a7468';
  g.lineWidth = 0.8;
  g.beginPath();
  for (let i = 1; i < 6; i++) {
    g.moveTo(bx - 42 + i * 14, by - 16);
    g.lineTo(bx - 42 + i * 14 + (i % 2) * 3, by);
  }
  g.stroke();
  g.beginPath();
  g.rect(bx - 40, by - 52, 80, 36);
  fillInk(g, '#efe0c0', th.ink);
  g.strokeStyle = '#8a6040';
  g.lineWidth = 2.2;
  g.beginPath();
  g.moveTo(bx - 40, by - 34);
  g.lineTo(bx + 40, by - 34);
  g.moveTo(bx - 14, by - 52);
  g.lineTo(bx - 14, by - 16);
  g.moveTo(bx + 14, by - 52);
  g.lineTo(bx + 14, by - 16);
  g.stroke();
  windowAt(g, bx - 34, by - 48, 12, 10, th.ink, lights);
  windowAt(g, bx + 22, by - 48, 12, 10, th.ink, lights);
  windowAt(g, bx - 5, by - 30, 10, 10, th.ink, lights);
  // the roof, seen from above: a big slate slope
  g.beginPath();
  g.moveTo(bx - 50, by - 50);
  g.lineTo(bx - 34, by - 82);
  g.lineTo(bx + 34, by - 82);
  g.lineTo(bx + 50, by - 50);
  g.closePath();
  fillInk(g, '#6a6478', th.ink);
  g.strokeStyle = '#57516a';
  g.lineWidth = 0.9;
  g.beginPath();
  for (let i = 1; i < 4; i++) {
    const yy = by - 50 - i * 8;
    g.moveTo(bx - 50 + i * 4, yy);
    g.lineTo(bx + 50 - i * 4, yy);
  }
  g.stroke();
  // chimney
  g.beginPath();
  g.rect(bx + 18, by - 92, 9, 16);
  fillInk(g, '#a0786a', th.ink, LW_S);
  // the wheel, half in the water
  const wx = bx - 52;
  const wy = by - 12;
  const R = 22;
  g.beginPath();
  g.rect(wx - 3, wy - 2, 10, 8);
  fillInk(g, '#7a5236', th.ink, LW_S);
  ell(g, wx, wy - 6, R, R);
  fillInk(g, '#a8784c', th.ink);
  ell(g, wx, wy - 6, R - 5, R - 5);
  fillInk(g, '#5a7a8a', th.ink, LW_S);
  g.strokeStyle = '#7a5236';
  g.lineWidth = 2.2;
  g.beginPath();
  for (let i = 0; i < 4; i++) {
    const t = (i / 4) * Math.PI;
    g.moveTo(wx + Math.cos(t) * (R - 5), wy - 6 + Math.sin(t) * (R - 5));
    g.lineTo(wx - Math.cos(t) * (R - 5), wy - 6 - Math.sin(t) * (R - 5));
  }
  g.stroke();
  g.fillStyle = '#c99a62';
  for (let i = 0; i < 10; i++) {
    const t = (i / 10) * TAU;
    g.save();
    g.translate(wx + Math.cos(t) * R, wy - 6 + Math.sin(t) * R);
    g.rotate(t);
    g.beginPath();
    g.rect(-1, -3.5, 6, 7);
    fillInk(g, '#c99a62', th.ink, 0.8);
    g.restore();
  }
  ell(g, wx, wy - 6, 4, 4);
  fillInk(g, '#5a3a24', th.ink, LW_S);
  // white water where the wheel churns
  g.strokeStyle = th.water[2];
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(wx - 18, wy + 12);
  g.quadraticCurveTo(wx - 8, wy + 8, wx + 2, wy + 13);
  g.moveTo(wx + 4, wy + 15);
  g.quadraticCurveTo(wx + 12, wy + 11, wx + 20, wy + 15);
  g.stroke();
}

/**
 * A ledge of rock with water pouring off it into the creek below: the Great Falls at a gate (big), a
 * cascade by a stop (small). (x, y) is where the water lands. Seen from a little above: the grassy top
 * of the ledge, the stream running across it to the lip, the rock face below, foam and spray.
 */
function falls(g: G, x: number, y: number, big: boolean, th: MapTheme, lights: Lights, seed: number) {
  const W = big ? 150 : 74;
  const H = big ? 118 : 50;
  const fw = big ? 30 : 13;
  const base = y + 2;
  const top = base - H;
  const lip = (u: number) => top + Math.sin(u * 23 + seed) * 2.5 + Math.sin(u * 7 + seed * 2) * 3;
  // the rock face: a lip that rounds down at both ends
  g.beginPath();
  g.moveTo(x - W, base);
  g.quadraticCurveTo(x - W * 0.98, top + H * 0.2, x - W * 0.82, lip(0.08));
  for (let i = 1; i <= 10; i++) {
    const u = 0.08 + (i / 10) * 0.84;
    g.lineTo(x - W + u * 2 * W, lip(u));
  }
  g.quadraticCurveTo(x + W * 0.98, top + H * 0.2, x + W, base);
  g.quadraticCurveTo(x, base + 8, x - W, base);
  g.closePath();
  fillInk(g, th.stone[0], th.ink);
  g.save();
  g.clip();
  g.fillStyle = th.stone[2];
  g.fillRect(x - W, top + H * 0.55, 2 * W, H);
  // strata and cracks
  g.strokeStyle = th.ink;
  g.globalAlpha = 0.35;
  g.lineWidth = 0.9;
  g.beginPath();
  for (let i = 0; i < 3; i++) {
    const yy = top + H * (0.3 + i * 0.22);
    g.moveTo(x - W, yy + Math.sin(i * 3 + seed) * 3);
    g.quadraticCurveTo(x, yy + 5 * Math.sin(seed + i), x + W, yy - 2);
  }
  for (let i = 0; i < (big ? 14 : 7); i++) {
    const cx = x - W + ((i + 0.5) / (big ? 14 : 7)) * 2 * W;
    const cy = top + H * (0.15 + ((i * 0.37 + seed * 0.01) % 0.5));
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.sin(i * 5.3) * 4, cy + H * 0.22);
  }
  g.stroke();
  g.restore();
  // the grassy top, a stream across it to the lip
  g.beginPath();
  g.moveTo(x - W * 0.84, lip(0.08));
  for (let i = 1; i <= 10; i++) {
    const u = 0.08 + (i / 10) * 0.84;
    g.lineTo(x - W + u * 2 * W, lip(u));
  }
  g.quadraticCurveTo(x + W * 0.7, top - 16, x, top - 18);
  g.quadraticCurveTo(x - W * 0.7, top - 16, x - W * 0.84, lip(0.08));
  g.closePath();
  fillInk(g, th.ground[1], th.ink);
  g.beginPath();
  g.moveTo(x - fw * 0.55, top + 2);
  g.quadraticCurveTo(x - fw * 0.9, top - 10, x - fw * 0.2, top - 18);
  g.lineTo(x + fw * 0.6, top - 18);
  g.quadraticCurveTo(x + fw * 0.2, top - 8, x + fw * 0.6, top + 2);
  g.closePath();
  fillInk(g, th.water[1], th.ink, LW_S);
  // the water: a sheet with streaks down the face, foam where it lands, spray
  g.beginPath();
  g.moveTo(x - fw * 0.62, top + 1);
  g.lineTo(x + fw * 0.62, top + 1);
  g.quadraticCurveTo(x + fw * 0.8, base - H * 0.4, x + fw, base + 1);
  g.lineTo(x - fw, base + 1);
  g.quadraticCurveTo(x - fw * 0.8, base - H * 0.4, x - fw * 0.62, top + 1);
  g.closePath();
  fillInk(g, th.water[1], th.ink);
  g.strokeStyle = th.water[2];
  g.lineCap = 'round';
  g.lineWidth = big ? 2.2 : 1.5;
  g.beginPath();
  const n = big ? 6 : 3;
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n - 0.5;
    g.moveTo(x + u * fw * 1.2, top + 6 + (i % 2) * 10);
    g.lineTo(x + u * fw * 1.6, base - 6 - (i % 3) * 8);
  }
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.88)';
  for (let i = 0; i < (big ? 9 : 5); i++) {
    const u = (i / ((big ? 9 : 5) - 1) - 0.5) * 2;
    ell(g, x + u * fw * 1.2, base + 2 + Math.abs(u) * 2, fw * (big ? 0.3 : 0.34), fw * 0.17);
    g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.3)';
  ell(g, x, base - 5, fw * 2.4, fw * 0.95);
  g.fill();
  if (big) {
    ell(g, x - fw * 0.9, base - 24, fw * 1.5, fw * 0.8);
    g.fill();
    ell(g, x + fw * 1.1, base - 40, fw * 1.1, fw * 0.6);
    g.fill();
  }
  // pines along the top
  const spots = big ? [0.14, 0.26, 0.66, 0.8, 0.9] : [0.22, 0.76];
  spots.forEach((u, i) => pine(g, { k: K.pine, x: x - W + u * 2 * W, y: lip(u) - 4, s: big ? 14 + (i % 2) * 4 : 11, a: 0.5, b: 0.5, c: (i * 0.37) % 1 }, th));
  void lights;
}

function hollowTree(g: G, x: number, y: number, th: MapTheme, lights: Lights) {
  shadow(g, x + 10, y + 4, 60, 14);
  // roots and trunk
  g.beginPath();
  g.moveTo(x - 40, y + 4);
  g.quadraticCurveTo(x - 26, y - 6, x - 22, y - 40);
  g.lineTo(x - 18, y - 92);
  g.lineTo(x + 20, y - 92);
  g.lineTo(x + 24, y - 40);
  g.quadraticCurveTo(x + 28, y - 6, x + 44, y + 4);
  g.quadraticCurveTo(x, y + 10, x - 40, y + 4);
  g.closePath();
  fillInk(g, th.trunk, th.ink);
  g.strokeStyle = th.ink;
  g.globalAlpha = 0.4;
  g.lineWidth = 0.9;
  g.beginPath();
  for (const dx of [-12, 0, 11]) {
    g.moveTo(x + dx, y - 86);
    g.quadraticCurveTo(x + dx + 3, y - 60, x + dx - 2, y - 40);
  }
  g.stroke();
  g.globalAlpha = 1;
  // the hollow
  g.beginPath();
  g.ellipse(x + 1, y - 16, 13, 18, 0, Math.PI, TAU);
  g.lineTo(x + 14, y - 2);
  g.quadraticCurveTo(x, y + 2, x - 12, y - 2);
  g.closePath();
  fillInk(g, '#1d1810', th.ink);
  lights.push(x - 6, y - 16, 4, 3, x + 4, y - 16, 4, 3);
  // the crown
  const cy = y - 120;
  puff(
    g,
    [
      [x - 46, cy + 18, 30],
      [x + 46, cy + 16, 30],
      [x - 18, cy - 14, 36],
      [x + 22, cy - 18, 34],
      [x, cy + 22, 34],
    ],
    th.leaf[0],
    th.leafDark,
    th.leafLight,
    th.ink,
  );
}

function barn(g: G, x: number, y: number, th: MapTheme, lights: Lights) {
  shadow(g, x + 8, y + 4, 52, 12);
  // walls and the gable end, roof slope behind
  g.beginPath();
  g.moveTo(x - 46, y - 40);
  g.lineTo(x - 20, y - 70);
  g.lineTo(x + 44, y - 70);
  g.lineTo(x + 58, y - 44);
  g.lineTo(x + 30, y - 40);
  g.closePath();
  fillInk(g, '#7a4a42', th.ink);
  g.beginPath();
  g.rect(x - 40, y - 40, 70, 40);
  fillInk(g, '#c0503e', th.ink);
  g.beginPath();
  g.moveTo(x - 46, y - 38);
  g.lineTo(x - 5, y - 72);
  g.lineTo(x + 36, y - 38);
  g.closePath();
  fillInk(g, '#c0503e', th.ink);
  g.beginPath();
  g.rect(x - 16, y - 28, 22, 28);
  fillInk(g, '#9a3a2e', th.ink);
  g.strokeStyle = '#fff3e4';
  g.lineWidth = 1.6;
  g.beginPath();
  g.moveTo(x - 15, y - 27);
  g.lineTo(x + 5, y - 1);
  g.moveTo(x + 5, y - 27);
  g.lineTo(x - 15, y - 1);
  g.moveTo(x - 44, y - 38);
  g.lineTo(x - 5, y - 70);
  g.lineTo(x + 34, y - 38);
  g.stroke();
  windowAt(g, x - 10, y - 56, 10, 9, th.ink, lights);
  // hay, and a bit of fence
  g.beginPath();
  g.roundRect(x + 36, y - 14, 22, 14, 4);
  fillInk(g, '#e8c45a', th.ink);
  g.strokeStyle = '#b8902e';
  g.lineWidth = 0.8;
  g.beginPath();
  g.moveTo(x + 40, y - 12);
  g.lineTo(x + 40, y - 2);
  g.moveTo(x + 52, y - 12);
  g.lineTo(x + 52, y - 2);
  g.stroke();
  g.strokeStyle = th.ink;
  g.lineWidth = 2.6;
  g.beginPath();
  g.moveTo(x - 80, y + 10);
  g.lineTo(x - 46, y + 4);
  g.moveTo(x - 80, y + 2);
  g.lineTo(x - 46, y - 4);
  g.stroke();
  g.strokeStyle = '#d8b07a';
  g.lineWidth = 1.4;
  g.stroke();
  for (const fx of [-80, -63, -46]) {
    g.beginPath();
    g.rect(x + fx - 2, y - 8 + (fx + 80) * -0.18, 4, 18);
    fillInk(g, '#c89a64', th.ink, LW_S);
  }
}

function den(g: G, x: number, y: number, th: MapTheme, lights: Lights) {
  shadow(g, x + 6, y + 4, 46, 10);
  g.beginPath();
  g.moveTo(x - 46, y + 2);
  g.quadraticCurveTo(x - 40, y - 46, x, y - 50);
  g.quadraticCurveTo(x + 42, y - 46, x + 48, y + 2);
  g.closePath();
  fillInk(g, '#8a6a4a', th.ink);
  g.fillStyle = th.path.moss;
  blob(g, x - 6, y - 44, 26, 8, 0.2, 0.7, 6);
  g.fill();
  g.beginPath();
  g.ellipse(x, y - 4, 16, 20, 0, Math.PI, TAU);
  g.closePath();
  fillInk(g, '#1c1612', th.ink);
  lights.push(x - 7, y - 14, 4, 3, x + 3, y - 14, 4, 3);
  // the loot: a jar of fireflies, bottle caps, a can
  g.beginPath();
  g.roundRect(x + 24, y - 16, 12, 15, 3);
  fillInk(g, 'rgba(214,240,236,0.85)', th.ink, LW_S);
  g.beginPath();
  g.rect(x + 25, y - 19, 10, 4);
  fillInk(g, '#b89a5e', th.ink, 0.8);
  lights.push(x + 26, y - 13, 8, 9);
  for (const [cx, cy, col] of [
    [-30, 4, '#d4b040'],
    [-22, 8, '#c84a3a'],
    [16, 8, '#d4b040'],
  ] as const) {
    ell(g, x + cx, y + cy, 3, 1.6);
    fillInk(g, col, th.ink, 0.7);
  }
  g.beginPath();
  g.rect(x - 40, y - 8, 7, 10);
  fillInk(g, '#9aa8b0', th.ink, 0.8);
}

function nest(g: G, x: number, y: number, th: MapTheme, lights: Lights) {
  // a crag, and on top of it a great untidy nest with things glinting in it
  shadow(g, x + 6, y + 4, 34, 9);
  g.beginPath();
  g.moveTo(x - 28, y + 2);
  g.lineTo(x - 22, y - 40);
  g.lineTo(x - 12, y - 62);
  g.lineTo(x + 14, y - 64);
  g.lineTo(x + 22, y - 38);
  g.lineTo(x + 30, y + 2);
  g.closePath();
  fillInk(g, th.stone[0], th.ink);
  g.fillStyle = th.stone[1];
  g.beginPath();
  g.moveTo(x - 20, y - 42);
  g.lineTo(x - 11, y - 60);
  g.lineTo(x + 2, y - 61);
  g.lineTo(x - 6, y - 36);
  g.closePath();
  g.fill();
  ell(g, x, y - 66, 30, 12);
  fillInk(g, '#8a6a46', th.ink);
  g.strokeStyle = '#5e4630';
  g.lineWidth = 1.1;
  g.beginPath();
  for (let i = 0; i < 9; i++) {
    const t = (i / 9) * Math.PI * 2;
    g.moveTo(x + Math.cos(t) * 30, y - 66 + Math.sin(t) * 12);
    g.lineTo(x + Math.cos(t + 0.9) * 22, y - 66 + Math.sin(t + 0.9) * 8);
  }
  g.stroke();
  ell(g, x, y - 69, 20, 6);
  g.fillStyle = '#4a3624';
  g.fill();
  for (const [gx, gy, col] of [
    [-8, -71, '#ffd84a'],
    [6, -70, '#c8d0d8'],
    [-1, -73, '#ffcd38'],
  ] as const) {
    ell(g, x + gx, y + gy, 3, 2);
    fillInk(g, col, th.ink, 0.7);
  }
  lights.push(x - 10, y - 74, 20, 6);
}

/** Draw a landmark (its anchor at x, y; side: which side of its stop it stands on). */
export function drawMark(g: G, kind: string, x: number, y: number, side: number, th: MapTheme, lights: Lights, seed: number) {
  switch (kind) {
    case 'home':
      return home(g, x, y, th);
    case 'millrace':
      return mill(g, x, y, side, th, lights);
    case 'fallsfoot':
      return falls(g, x, y, true, th, lights, seed);
    case 'cliff':
      return falls(g, x, y, false, th, lights, seed);
    case 'hollowtree':
      return hollowTree(g, x, y, th, lights);
    case 'barn':
      return barn(g, x, y, th, lights);
    case 'den':
      return den(g, x, y, th, lights);
    case 'nest':
      return nest(g, x, y, th, lights);
  }
}

// ------------------------------------------------------------------ stops

/** A flat round stone, seen from a little above: its side, its top, a light on it. */
export function stone(g: G, x: number, y: number, r: number, th: MapTheme, alpha = 1) {
  const ry = r * 0.6;
  g.globalAlpha = alpha;
  ell(g, x, y + 4, r, ry);
  fillInk(g, th.stone[2], th.ink);
  ell(g, x, y, r, ry);
  fillInk(g, th.stone[0], th.ink);
  g.fillStyle = th.stone[1];
  ell(g, x - r * 0.18, y - ry * 0.22, r * 0.62, ry * 0.5);
  g.fill();
  // moss creeping over the rim
  g.fillStyle = th.path.moss;
  g.beginPath();
  g.ellipse(x + r * 0.55, y + ry * 0.45, r * 0.3, ry * 0.3, -0.3, 0, TAU);
  g.ellipse(x - r * 0.62, y + ry * 0.2, r * 0.18, ry * 0.26, 0.4, 0, TAU);
  g.fill();
  g.globalAlpha = 1;
}

/** A flower open on a cleared stop. `open` 0..1 (it unfolds when the level is cleared). */
export function bloom(g: G, x: number, y: number, size: number, open: number, ink: string, petal = '#ff9dbb') {
  if (open <= 0) return;
  g.save();
  g.translate(x, y);
  g.scale(open, open);
  g.lineWidth = LW_S;
  g.strokeStyle = ink;
  // two leaves
  g.fillStyle = '#8dbb3e';
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, 2);
    g.quadraticCurveTo(s * size * 0.7, -size * 0.1, s * size * 1.1, size * 0.25);
    g.quadraticCurveTo(s * size * 0.55, size * 0.55, 0, 2);
    g.fill();
    g.stroke();
  }
  g.beginPath();
  g.moveTo(0, 2);
  g.lineTo(0, -size * 0.6);
  g.lineWidth = 1.6;
  g.strokeStyle = '#5d8a2a';
  g.stroke();
  g.lineWidth = LW_S;
  g.strokeStyle = ink;
  for (let i = 0; i < 5; i++) {
    const t = (i / 5) * TAU - Math.PI / 2;
    ell(g, Math.cos(t) * size * 0.42, -size * 0.75 + Math.sin(t) * size * 0.3, size * 0.36, size * 0.26);
    g.fillStyle = i % 2 ? petal : '#ffc4d6';
    g.fill();
    g.stroke();
  }
  ell(g, 0, -size * 0.75, size * 0.2, size * 0.16);
  g.fillStyle = '#ffe066';
  g.fill();
  g.stroke();
  g.restore();
}

/** A green shoot with a closed bud: an open level, not yet cleared. */
export function bud(g: G, x: number, y: number, size: number, ink: string) {
  g.lineWidth = 1.7;
  g.strokeStyle = '#5d8a2a';
  g.beginPath();
  g.moveTo(x, y + 1);
  g.quadraticCurveTo(x - 1.5, y - size * 0.4, x, y - size * 0.7);
  g.stroke();
  g.lineWidth = LW_S;
  g.strokeStyle = ink;
  g.fillStyle = '#8dbb3e';
  g.beginPath();
  g.moveTo(x, y - size * 0.25);
  g.quadraticCurveTo(x + size * 0.45, y - size * 0.5, x + size * 0.62, y - size * 0.22);
  g.quadraticCurveTo(x + size * 0.3, y - size * 0.08, x, y - size * 0.25);
  g.fill();
  g.stroke();
  g.beginPath();
  g.ellipse(x, y - size * 0.88, size * 0.24, size * 0.32, 0, 0, TAU);
  g.fillStyle = '#ff9dbb';
  g.fill();
  g.stroke();
  g.fillStyle = '#ffd0de';
  ell(g, x - size * 0.07, y - size * 0.98, size * 0.08, size * 0.12);
  g.fill();
}

/** A seed lying on the stone: a level still to come. */
export function seedling(g: G, x: number, y: number, ink: string) {
  g.save();
  g.translate(x, y - 2);
  g.rotate(-0.5);
  g.beginPath();
  g.moveTo(-4.5, 0);
  g.bezierCurveTo(-3, -3.6, 3, -3.6, 4.5, 0);
  g.bezierCurveTo(3, 3.6, -3, 3.6, -4.5, 0);
  g.fillStyle = '#b8874e';
  g.fill();
  g.lineWidth = LW_S;
  g.strokeStyle = ink;
  g.stroke();
  g.restore();
}

/** A pennant on a stick: a side spot (the practice ground, the test course). */
export function pennant(g: G, x: number, y: number, col: string, ink: string) {
  g.lineWidth = 2.6;
  g.strokeStyle = ink;
  g.beginPath();
  g.moveTo(x, y);
  g.lineTo(x, y - 26);
  g.stroke();
  g.lineWidth = 1.2;
  g.strokeStyle = '#c99a62';
  g.stroke();
  g.beginPath();
  g.moveTo(x, y - 26);
  g.quadraticCurveTo(x + 9, y - 24, x + 16, y - 21);
  g.quadraticCurveTo(x + 8, y - 18, x, y - 15);
  g.closePath();
  fillInk(g, col, ink, LW_S);
}

/** A stump with the storybook open on it: a world's gate. */
export function book(g: G, x: number, y: number, ink: string) {
  // the stump
  shadow(g, x + 3, y + 3, 15, 5);
  g.beginPath();
  g.moveTo(x - 11, y - 9);
  g.lineTo(x - 12, y + 1);
  g.quadraticCurveTo(x, y + 6, x + 12, y + 1);
  g.lineTo(x + 11, y - 9);
  g.closePath();
  fillInk(g, '#8a6040', ink);
  ell(g, x, y - 9, 11, 4.4);
  fillInk(g, '#d8b888', ink);
  // the book, open, a ribbon hanging out
  g.save();
  g.translate(x, y - 14);
  g.fillStyle = '#c83e4e';
  g.beginPath();
  g.rect(-1, 2, 2.4, 9);
  g.fill();
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(0, 2);
    g.quadraticCurveTo(s * 6, -2, s * 14, 0);
    g.lineTo(s * 13, 6);
    g.quadraticCurveTo(s * 6, 4, 0, 7);
    g.closePath();
    fillInk(g, '#fff6e2', ink, LW_S);
    g.strokeStyle = '#b8ab92';
    g.lineWidth = 0.6;
    g.beginPath();
    for (let i = 1; i < 4; i++) {
      g.moveTo(s * 3, 1.5 + i * 1.2);
      g.lineTo(s * 11, 1 + i * 1.3);
    }
    g.stroke();
  }
  g.restore();
}
