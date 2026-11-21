/**
 * The title's scenery: a mossy creek on a yellow-green morning — the kind of place this game is about.
 * A waterfall comes down a mossy rock face on the right, clear of the buttons, into a creek that runs
 * across behind the two sprouts, who stand on a mossy bank in front.
 *
 * The rock, the banks, the stones, the moss and the ferns are painted once per screen size (two
 * canvases, cropped to where they are); a frame only moves the water — streaks down the fall, foam
 * where it lands, ripples and glints running down the creek — and a few fireflies over it.
 */
import { rng, TAU } from '../core/math';
import { canvasEpoch } from './renderer';

/** The near bank's top, as a fraction of the height: where the sprouts stand. */
export const CREEK_BANK = 0.86;

const MOSS = ['#a8c94a', '#94bb3f', '#c2da62', '#b5d35a', '#d2e57a'];
const MOSS_DARK = ['#5f8a2a', '#6d9632', '#4e7724', '#7a9f38'];
const ROCK = { top: '#8e9b86', base: '#6f7d68', dark: '#4d594a', line: '#3f4a3c' };

/** where things are, as fractions of the width (x) and height (y) */
const G = {
  creekTop: 0.7,
  creekBottom: 0.9,
  lipY: 0.3,
  /** the waterfall: left and right edges at the lip, and where it lands */
  fallTop: [0.778, 0.822],
  fallBottom: [0.765, 0.835],
  fallLand: 0.735,
  rockTop: 0.18,
  rockBottom: 0.76,
  banksTop: 0.6,
};

type Ctx = CanvasRenderingContext2D;

/** Dots of moss, lichen or grit over whatever the current clip allows. */
function stipple(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, n: number, colors: string[], rMin: number, rMax: number, r: () => number) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(r() * colors.length)];
    ctx.beginPath();
    ctx.arc(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), rMin + r() * (rMax - rMin), 0, TAU);
    ctx.fill();
  }
}

/** A fern frond: a curved stem with leaflets in pairs, smaller toward the tip. */
function fern(ctx: Ctx, x: number, y: number, len: number, angle: number, bend: number, color: string) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  const steps = 9;
  let px = x;
  let py = y;
  let a = angle;
  for (let i = 0; i < steps; i++) {
    const seg = len / steps;
    const nx = px + Math.cos(a) * seg;
    const ny = py + Math.sin(a) * seg;
    ctx.lineWidth = Math.max(1, len * 0.02 * (1 - i / steps));
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    const leaf = len * 0.16 * (1 - i / (steps + 1));
    for (const side of [-1, 1]) {
      const la = a + side * 1.1;
      ctx.beginPath();
      ctx.ellipse(nx + Math.cos(la) * leaf * 0.5, ny + Math.sin(la) * leaf * 0.5, leaf * 0.55, leaf * 0.2, la, 0, TAU);
      ctx.fill();
    }
    px = nx;
    py = ny;
    a += bend;
  }
}

/** A rounded stone with a cap of moss on its top. */
function stone(ctx: Ctx, x: number, y: number, rx: number, ry: number, r: () => number) {
  ctx.fillStyle = ROCK.dark;
  ctx.beginPath();
  ctx.ellipse(x, y + ry * 0.12, rx, ry, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = r() < 0.5 ? ROCK.base : ROCK.top;
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.96, ry * 0.92, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, rx * 0.96, ry * 0.92, 0, 0, TAU);
  ctx.clip();
  ctx.fillStyle = MOSS[Math.floor(r() * 3)];
  ctx.beginPath();
  ctx.ellipse(x - rx * 0.1, y - ry * 0.75, rx * 1.05, ry * 0.62, 0, 0, TAU);
  ctx.fill();
  stipple(ctx, x - rx, y - ry, x + rx, y, Math.ceil(rx * 0.6), MOSS, rx * 0.04, rx * 0.1, r);
  ctx.restore();
}

/** A bumpy line from x0 to x1 around `y` (px), returned as points. */
function bumpy(x0: number, x1: number, y: number, amp: number, step: number, r: () => number): [number, number][] {
  const pts: [number, number][] = [];
  for (let x = x0; x <= x1 + step; x += step) pts.push([Math.min(x, x1), y + (r() - 0.5) * 2 * amp]);
  return pts;
}

export class CreekScene {
  private rock: HTMLCanvasElement | null = null;
  private banks: HTMLCanvasElement | null = null;
  private glow: HTMLCanvasElement | null = null;
  private key = '';
  private readonly ripples: { y: number; x: number; len: number; speed: number; p: number }[] = [];
  private readonly glints: { x: number; y: number; k: number; p: number }[] = [];
  private readonly streaks: { u: number; len: number; speed: number; p: number; w: number }[] = [];
  private readonly motes: { x: number; y: number; p: number; q: number }[] = [];

  constructor() {
    const r = rng(7);
    for (let i = 0; i < 44; i++) this.ripples.push({ y: r(), x: r(), len: 0.02 + r() * 0.05, speed: 0.012 + r() * 0.03, p: r() * TAU });
    for (let i = 0; i < 16; i++) this.glints.push({ x: r(), y: r(), k: 0.8 + r() * 1.6, p: r() * TAU });
    for (let i = 0; i < 28; i++) this.streaks.push({ u: r(), len: 0.05 + r() * 0.08, speed: 0.55 + r() * 0.45, p: r(), w: 1 + r() * 1.6 });
    for (let i = 0; i < 9; i++) this.motes.push({ x: 0.05 + r() * 0.9, y: 0.42 + r() * 0.36, p: r() * TAU, q: r() * TAU });
  }

  draw(ctx: Ctx, W: number, H: number, t: number) {
    const key = `${W}x${H}:${canvasEpoch}`;
    if (key !== this.key || !this.rock || !this.banks || !this.glow) {
      this.paint(W, H);
      this.key = key;
    }
    const s = H / 420;
    this.drawFall(ctx, W, H, s, t);
    ctx.drawImage(this.rock!, 0, Math.round(G.rockTop * H));
    this.drawCreek(ctx, W, H, s, t);
    this.drawFoam(ctx, W, H, s, t);
    ctx.drawImage(this.banks!, 0, Math.round(G.banksTop * H));
    this.drawMotes(ctx, W, H, s, t);
  }

  // ------------------------------------------------------------------ the water (every frame)

  private fallEdges(W: number, H: number, y: number) {
    const u = (y - G.lipY * H) / ((G.fallLand - G.lipY) * H);
    const k = Math.max(0, Math.min(1, u));
    return [W * (G.fallTop[0] + (G.fallBottom[0] - G.fallTop[0]) * k), W * (G.fallTop[1] + (G.fallBottom[1] - G.fallTop[1]) * k)];
  }

  private drawFall(ctx: Ctx, W: number, H: number, s: number, t: number) {
    const y0 = G.lipY * H;
    const y1 = G.fallLand * H + 4 * s;
    const [a0, b0] = this.fallEdges(W, H, y0);
    const [a1, b1] = this.fallEdges(W, H, y1);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(a0, y0);
    ctx.lineTo(b0, y0);
    ctx.lineTo(b1, y1);
    ctx.lineTo(a1, y1);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, 'rgba(206,238,232,0.96)');
    g.addColorStop(1, 'rgba(176,222,226,0.92)');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.clip();
    // the darker body of the water between the bright sheets
    ctx.fillStyle = 'rgba(120,180,190,0.28)';
    for (const u of [0.22, 0.58, 0.8]) {
      const x = a0 + (b0 - a0) * u;
      ctx.fillRect(x - 3 * s, y0, 5 * s, y1 - y0);
    }
    // streaks running down it
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineCap = 'round';
    const span = y1 - y0;
    for (const k of this.streaks) {
      const len = k.len * H;
      const y = y0 - len + ((k.p + (t * k.speed * H) / (span + len)) % 1) * (span + len);
      const [ea, eb] = this.fallEdges(W, H, y + len / 2);
      const x = ea + (eb - ea) * k.u;
      ctx.lineWidth = k.w * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (k.u - 0.5) * 2 * s, y + len);
      ctx.stroke();
    }
    ctx.restore();
    // the water bending over the lip
    ctx.strokeStyle = `rgba(255,255,255,${0.75 + 0.15 * Math.sin(t * 3)})`;
    ctx.lineWidth = 2.6 * s;
    ctx.beginPath();
    ctx.moveTo(a0, y0 + 1.5 * s);
    ctx.quadraticCurveTo((a0 + b0) / 2, y0 - 2.5 * s, b0, y0 + 1.5 * s);
    ctx.stroke();
  }

  private drawCreek(ctx: Ctx, W: number, H: number, s: number, t: number) {
    const top = G.creekTop * H;
    const bot = G.creekBottom * H;
    const g = ctx.createLinearGradient(0, top, 0, bot);
    g.addColorStop(0, '#6f9f7c');
    g.addColorStop(0.35, '#54928a');
    g.addColorStop(1, '#3b7880');
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, bot - top);
    // the far bank's green, mirrored in the water just below it
    ctx.fillStyle = 'rgba(52,88,40,0.3)';
    ctx.fillRect(0, top, W, (bot - top) * 0.16);
    // ripples running downstream (right to left, away from the fall), longer and bolder nearer you
    ctx.lineCap = 'round';
    for (const p of this.ripples) {
      const near = p.y;
      const y = top + (bot - top) * (0.18 + near * 0.74) + Math.sin(t * 1.3 + p.p) * 1.4 * s;
      const len = p.len * W * (0.55 + near * 0.8);
      const x = ((((p.x - t * p.speed * (0.6 + near)) % 1.25) + 1.25) % 1.25) * W - 0.15 * W;
      ctx.strokeStyle = `rgba(222,246,236,${(0.14 + 0.22 * (0.5 + 0.5 * Math.sin(t * 2 + p.p))) * (0.55 + near * 0.6)})`;
      ctx.lineWidth = (1 + near * 1.6) * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
    // sun glints winking on the surface
    ctx.fillStyle = '#fffbe0';
    for (const g2 of this.glints) {
      const a = Math.pow(Math.max(0, Math.sin(t * g2.k + g2.p)), 6);
      if (a < 0.05) continue;
      ctx.globalAlpha = a * 0.9;
      ctx.beginPath();
      ctx.arc(g2.x * W, top + (bot - top) * (0.2 + g2.y * 0.7), (1.2 + a) * s, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawFoam(ctx: Ctx, W: number, H: number, s: number, t: number) {
    const cx = ((G.fallBottom[0] + G.fallBottom[1]) / 2) * W;
    const cy = G.fallLand * H + 3 * s;
    const mist = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.12 * H);
    mist.addColorStop(0, 'rgba(255,255,255,0.42)');
    mist.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mist;
    ctx.fillRect(cx - 0.12 * H, cy - 0.12 * H, 0.24 * H, 0.24 * H);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 12; i++) {
      const p = i * 1.7;
      const x = cx + Math.sin(i * 2.3) * (G.fallBottom[1] - G.fallBottom[0]) * W * 0.6;
      const y = cy + Math.cos(i * 1.9) * 4 * s;
      const rad = (4 + (i % 4) * 2.2) * s * (0.8 + 0.3 * Math.sin(t * 3.1 + p));
      ctx.beginPath();
      ctx.arc(x, y, rad, 0, TAU);
      ctx.fill();
    }
  }

  private drawMotes(ctx: Ctx, W: number, H: number, s: number, t: number) {
    const glow = this.glow!;
    const size = 26 * s;
    for (const m of this.motes) {
      const x = (m.x + Math.sin(t * 0.25 + m.p) * 0.03) * W;
      const y = (m.y + Math.sin(t * 0.4 + m.q) * 0.025) * H;
      ctx.globalAlpha = 0.35 + 0.5 * Math.pow(0.5 + 0.5 * Math.sin(t * 1.3 + m.p * 3), 2);
      ctx.drawImage(glow, x - size / 2, y - size / 2, size, size);
    }
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ the still parts (once per size)

  private paint(W: number, H: number) {
    const s = H / 420;
    const r = rng(23);
    // a firefly's glow, drawn once
    const glow = (this.glow ??= document.createElement('canvas'));
    glow.width = glow.height = 64;
    const gc = glow.getContext('2d')!;
    gc.clearRect(0, 0, 64, 64);
    const rg = gc.createRadialGradient(32, 32, 0, 32, 32, 32);
    rg.addColorStop(0, 'rgba(250,255,200,1)');
    rg.addColorStop(0.18, 'rgba(226,246,140,0.85)');
    rg.addColorStop(1, 'rgba(200,236,110,0)');
    gc.fillStyle = rg;
    gc.fillRect(0, 0, 64, 64);

    // ---- the rock: the cliff on the right with the fall's channel cut through it, and boulders on the left
    const ry0 = G.rockTop * H;
    const rock = (this.rock ??= document.createElement('canvas'));
    rock.width = W;
    rock.height = Math.ceil((G.rockBottom - G.rockTop) * H);
    const c = rock.getContext('2d')!;
    c.clearRect(0, 0, rock.width, rock.height);
    c.save();
    c.translate(0, -ry0);
    const ridge: [number, number][] = [
      [0.64, 0.76], [0.643, 0.56], [0.655, 0.44], [0.675, 0.37], [0.705, 0.325], [0.74, 0.305], [G.fallTop[0], G.lipY],
      [G.fallTop[1], G.lipY], [0.85, 0.285], [0.885, 0.268], [0.925, 0.252], [0.965, 0.232], [1.001, 0.22], [1.001, 0.76],
    ];
    const cliff = () => {
      c.beginPath();
      ridge.forEach(([x, y], i) => (i ? c.lineTo(x * W, y * H) : c.moveTo(x * W, y * H)));
      c.closePath();
    };
    cliff();
    const rgr = c.createLinearGradient(0, 0.22 * H, 0, 0.76 * H);
    rgr.addColorStop(0, ROCK.top);
    rgr.addColorStop(0.5, ROCK.base);
    rgr.addColorStop(1, ROCK.dark);
    c.fillStyle = rgr;
    c.fill();
    c.save();
    cliff();
    c.clip();
    // ledges and cracks in the stone
    c.strokeStyle = ROCK.line;
    c.lineWidth = 1.4 * s;
    for (let i = 0; i < 9; i++) {
      const y = (0.36 + r() * 0.36) * H;
      const x = (0.65 + r() * 0.33) * W;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + 18 * s, y - 4 * s + r() * 8 * s, x + (30 + r() * 40) * s, y + (r() - 0.5) * 6 * s);
      c.stroke();
    }
    // moss: a thick cap along the top, and patches down the face
    for (let k = 1; k < ridge.length - 2; k++) {
      const [xa, ya] = ridge[k];
      const [xb, yb] = ridge[k + 1];
      for (let u = 0; u <= 1; u += 0.08) {
        const x = (xa + (xb - xa) * u) * W;
        const y = (ya + (yb - ya) * u) * H;
        c.fillStyle = MOSS[Math.floor(r() * MOSS.length)];
        c.beginPath();
        c.ellipse(x, y + 3 * s, (9 + r() * 8) * s, (5 + r() * 4) * s, 0, 0, TAU);
        c.fill();
      }
    }
    for (let i = 0; i < 26; i++) {
      const x = (0.65 + r() * 0.35) * W;
      const y = (0.34 + r() * 0.38) * H;
      c.fillStyle = r() < 0.6 ? MOSS[Math.floor(r() * MOSS.length)] : MOSS_DARK[Math.floor(r() * MOSS_DARK.length)];
      c.beginPath();
      c.ellipse(x, y, (6 + r() * 14) * s, (3 + r() * 5) * s, (r() - 0.5) * 0.5, 0, TAU);
      c.fill();
    }
    stipple(c, 0.64 * W, 0.22 * H, W, 0.76 * H, Math.ceil(700 * (W / H) * 0.4), [...MOSS, ROCK.top, ROCK.dark], 0.6 * s, 1.6 * s, r);
    c.restore();
    // the channel the water falls through: cut out (the fall is drawn behind), its wet edges dark
    const [a0, b0] = [G.fallTop[0] * W, G.fallTop[1] * W];
    const [a1, b1] = [G.fallBottom[0] * W, G.fallBottom[1] * W];
    const y0 = G.lipY * H + 1;
    const y1 = 0.77 * H;
    c.save();
    c.globalCompositeOperation = 'destination-out';
    c.beginPath();
    c.moveTo(a0, y0);
    c.lineTo(b0, y0);
    c.lineTo(b1, y1);
    c.lineTo(a1, y1);
    c.closePath();
    c.fill();
    c.restore();
    c.strokeStyle = '#33402f';
    c.lineWidth = 3 * s;
    for (const [xa, xb] of [[a0, a1], [b0, b1]]) {
      c.beginPath();
      c.moveTo(xa, y0);
      c.lineTo(xb, y1);
      c.stroke();
    }
    // ferns and vines hanging off the lip either side of the fall
    for (let i = 0; i < 7; i++) {
      const left = i < 4;
      const x = left ? (0.69 + r() * 0.08) * W : (0.83 + r() * 0.14) * W;
      const y = (left ? 0.32 + r() * 0.02 : 0.27 + r() * 0.02) * H;
      fern(c, x, y, (22 + r() * 18) * s, Math.PI / 2 + (r() - 0.5) * 0.8, (r() - 0.5) * 0.12, r() < 0.5 ? '#7fae3c' : '#94c048');
    }
    // boulders on the far left, mossed over
    for (const [x, y, rx, ry] of [[0.03, 0.66, 0.07, 0.085], [0.12, 0.69, 0.055, 0.06], [0.05, 0.56, 0.05, 0.065], [0.19, 0.715, 0.035, 0.035]]) {
      stone(c, x * W, y * H, rx * H * 1.4, ry * H, r);
    }
    fern(c, 0.09 * W, 0.62 * H, 34 * s, -Math.PI / 2 - 0.5, 0.1, '#86b442');
    fern(c, 0.1 * W, 0.63 * H, 30 * s, -Math.PI / 2 + 0.5, -0.1, '#9ac64c');
    c.restore();

    // ---- the banks: the far one with a gap where the fall lands, and the near one the sprouts stand on
    const by0 = G.banksTop * H;
    const banks = (this.banks ??= document.createElement('canvas'));
    banks.width = W;
    banks.height = Math.ceil((1 - G.banksTop) * H) + 1;
    const b = banks.getContext('2d')!;
    b.clearRect(0, 0, banks.width, banks.height);
    b.save();
    b.translate(0, -by0);
    const far = (xa: number, xb: number) => {
      const topEdge = bumpy(xa * W, xb * W, 0.66 * H, 5 * s, 22 * s, r);
      const shore = bumpy(xa * W, xb * W, 0.728 * H, 3 * s, 26 * s, r).reverse();
      const path = () => {
        b.beginPath();
        topEdge.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
        shore.forEach(([x, y]) => b.lineTo(x, y));
        b.closePath();
      };
      path();
      const g = b.createLinearGradient(0, 0.65 * H, 0, 0.73 * H);
      g.addColorStop(0, '#a3c64a');
      g.addColorStop(0.35, '#6f9a32');
      g.addColorStop(1, '#4a6e26');
      b.fillStyle = g;
      b.fill();
      b.save();
      path();
      b.clip();
      stipple(b, xa * W, 0.64 * H, xb * W, 0.74 * H, Math.ceil((xb - xa) * 900), [...MOSS, ...MOSS_DARK], 0.6 * s, 1.8 * s, r);
      b.restore();
      // stones along the water's edge, ferns on top
      for (let x = xa * W + 10 * s; x < xb * W - 10 * s; x += (24 + r() * 46) * s) stone(b, x, 0.728 * H, (7 + r() * 9) * s, (4 + r() * 5) * s, r);
      for (let x = xa * W + 14 * s; x < xb * W - 14 * s; x += (40 + r() * 70) * s) {
        const col = r() < 0.5 ? '#7fae3c' : '#94c048';
        for (let k = 0; k < 4; k++) fern(b, x, 0.665 * H, (16 + r() * 12) * s, -Math.PI / 2 + (k - 1.5) * 0.45, (k - 1.5) * 0.05, col);
      }
    };
    far(0, G.fallBottom[0] - 0.012);
    far(G.fallBottom[1] + 0.012, 1);
    // the near bank
    const nearTop = bumpy(0, W, CREEK_BANK * H, 2.2 * s, 18 * s, r);
    // (flat where the sprouts stand, so their feet sit on it)
    for (const p of nearTop) if (Math.abs(p[0] - W / 2) < 70 * s) p[1] = CREEK_BANK * H;
    const near = () => {
      b.beginPath();
      nearTop.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
      b.lineTo(W, H + 1);
      b.lineTo(0, H + 1);
      b.closePath();
    };
    near();
    const ng = b.createLinearGradient(0, CREEK_BANK * H, 0, H);
    ng.addColorStop(0, '#a9cc4c');
    ng.addColorStop(0.18, '#7fa83a');
    ng.addColorStop(0.5, '#5d7f2c');
    ng.addColorStop(1, '#45632a');
    b.fillStyle = ng;
    b.fill();
    b.save();
    near();
    b.clip();
    stipple(b, 0, CREEK_BANK * H - 4 * s, W, H, Math.ceil(2200 * (W / H) * 0.5), [...MOSS, ...MOSS_DARK, '#e3ee9a'], 0.7 * s, 2.2 * s, r);
    // pebbles and little flowers in the moss
    for (let i = 0; i < 18; i++) stone(b, r() * W, (CREEK_BANK + 0.04 + r() * 0.1) * H, (3 + r() * 5) * s, (2 + r() * 3) * s, r);
    for (let i = 0; i < 26; i++) {
      const x = r() * W;
      const y = (CREEK_BANK + 0.015 + r() * 0.11) * H;
      b.fillStyle = r() < 0.5 ? '#fffbe6' : '#f3e36a';
      for (let k = 0; k < 5; k++) {
        b.beginPath();
        b.arc(x + Math.cos((k * TAU) / 5) * 1.6 * s, y + Math.sin((k * TAU) / 5) * 1.6 * s, 1.2 * s, 0, TAU);
        b.fill();
      }
      b.fillStyle = '#e0a23a';
      b.beginPath();
      b.arc(x, y, 0.9 * s, 0, TAU);
      b.fill();
    }
    b.restore();
    // a lip of brighter moss along the near bank's edge
    b.strokeStyle = '#c4dd62';
    b.lineWidth = 2.2 * s;
    b.beginPath();
    nearTop.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
    b.stroke();
    // big ferns in the near corners, for depth
    for (const [x, dir] of [[0.03, 1], [0.97, -1]]) {
      for (let k = 0; k < 6; k++) fern(b, x * W, H + 4 * s, (60 + r() * 30) * s, -Math.PI / 2 + dir * (0.15 + k * 0.17), dir * 0.05, k % 2 ? '#6f9e34' : '#88b542');
    }
    b.restore();
  }
}
