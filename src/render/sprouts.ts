import { clamp, TAU } from '../core/math';
import type { Bird } from '../game/bird';
import { LAND_SQUASH_MAX } from '../game/tuning';
import { drawHat, glow, hexRgb, type BirdColor } from './art';

/** Fresh yellow-green leaves (and the deeper green of their veins and outline). */
export const LEAF = '#a8d64a';
export const LEAF_DARK = '#5e8f22';
const ROOT = '#8a5a34';
/** the far-side limbs, in shadow */
const LIMB_DARK = '#6e4729';

// The sprouts' fixed details, kept here rather than written inline: these are drawn for both sprouts
// every frame, and a table written inside the draw call is a fresh array (and iterator) each time.
/** The tall sprout's crown: each leaf's angle, then its length. */
const CROWN: readonly (readonly number[])[] = [
  [-Math.PI / 2 - 0.75, 11],
  [-Math.PI / 2 + 0.75, 11],
  [-Math.PI / 2 + 0.1, 13],
];
/** Creases down the bark of the torso: x, then how much the curve leans. */
const BARK: readonly (readonly number[])[] = [
  [-4.2, 0.6],
  [-1.8, -0.5],
  [1.4, 0.3],
  [4.4, -0.2],
];
/** Speckles in the moss on the hips, from the hip line. */
const MOSS: readonly (readonly number[])[] = [
  [-4.2, -1.6],
  [-2.4, -0.2],
  [-1.1, -2.1],
  [2.1, -0.6],
];
/** Speckles on the small sprout's seed, from its centre. */
const SPECKS: readonly (readonly number[])[] = [
  [-5, -3],
  [-6, 1.5],
  [-3.2, 4.6],
];

/** How far above its centre a sprout's head reaches (leaves and all): bubbles and name tags sit above it. */
export function sproutTop(b: Bird) {
  return b.kind === 'tall' ? b.h / 2 + 17 : b.h / 2 + 15 * b.traits.art;
}

/** A pointed leaf from (0, 0) along +x, `len` long and `wid` wide. */
function leaf(ctx: CanvasRenderingContext2D, len: number, wid: number, fill: string, ink: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.45, -wid, len, 0);
  ctx.quadraticCurveTo(len * 0.45, wid, 0, 0);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.strokeStyle = LEAF_DARK;
  ctx.globalAlpha *= 0.7;
  ctx.beginPath();
  ctx.moveTo(len * 0.12, 0);
  ctx.lineTo(len * 0.82, 0);
  ctx.stroke();
  ctx.globalAlpha /= 0.7;
}

/** Two eyes (looking where the sprout looks), a blush and a little mouth, around (x, y). */
function face(ctx: CanvasRenderingContext2D, b: Bird, x: number, y: number, r: number, gap: number, ink: string, menu: boolean, open: boolean) {
  const lx = clamp(b.lookX * b.facing, -1, 1);
  const ly = clamp(b.lookY, -1, 1);
  for (let e = 0; e < 2; e++) {
    const ex = x + (e ? gap / 2 : -gap / 2);
    if (b.blinkT < 0 || menu) {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = ink;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.8, y);
      ctx.quadraticCurveTo(ex, y + r * 0.55, ex + r * 0.8, y);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.ellipse(ex, y, r, r * 1.15, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    const px = ex + lx * r * 0.38;
    const py = y + ly * r * 0.4;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(px, py, r * 0.58, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(px - r * 0.22, py - r * 0.25, r * 0.22, 0, TAU);
    ctx.fill();
  }
  // blush
  ctx.fillStyle = 'rgba(255,110,150,0.45)';
  for (let e = 0; e < 2; e++) {
    const ex = x + (e ? gap / 2 + r * 0.6 : -gap / 2 - r * 0.6);
    ctx.beginPath();
    ctx.ellipse(ex, y + r * 1.45, r * 0.7, r * 0.45, 0, 0, TAU);
    ctx.fill();
  }
  // mouth: a smile, or an "o" when it's working hard (straining, gliding, dashing)
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (open) {
    ctx.fillStyle = '#7a2e3a';
    ctx.ellipse(x, y + r * 1.75, r * 0.38, r * 0.48, 0, 0, TAU);
    ctx.fill();
  } else {
    ctx.moveTo(x - r * 0.45, y + r * 1.5);
    ctx.quadraticCurveTo(x, y + r * 2.05, x + r * 0.45, y + r * 1.5);
    ctx.stroke();
  }
}

/**
 * One twig leg: a thigh and a shin with a knot for a knee, ending in a little splayed root of a foot.
 * `side` is -1 for the far leg (drawn behind the body, in shadow) and 1 for the near one. The pose
 * comes from what the sprout is doing — striding on the ground, knees tucked while it rises, legs
 * trailing while it falls, folded against a wall it clings to, dangling while it hangs.
 */
function leg(ctx: CanvasRenderingContext2D, b: Bird, side: -1 | 1, hipX: number, hipY: number, feet: number, len: number) {
  const back = side < 0;
  let fx = hipX;
  let fy = feet;
  // how far the knee pushes forward of the straight line from hip to foot
  let bend = 1.2;
  if (b.cling !== 0) {
    // folded against the wall, toes braced on it (it faces the wall, and +x here is forward)
    fx = hipX + (back ? 1.4 : 3.4);
    fy = feet - (back ? 3 : 0.5);
    bend = 3.2;
  } else if (b.hanging) {
    fx = hipX + Math.sin(b.wingPhase * 0.6 + (back ? 1.1 : 0)) * 1.7;
    fy = feet + 1;
    bend = 1.5;
  } else if (b.dashT > 0) {
    fx = hipX - 4.4;
    fy = feet - 2.6;
    bend = 1;
  } else if (b.anchored) {
    // planted: legs braced apart, knees deep, toes dug in
    fx = hipX + (back ? -2.8 : 2.4);
    fy = feet;
    bend = len * 0.34;
  } else if (!b.grounded) {
    if (b.vy < 0) {
      fx = hipX + (back ? -1.5 : 2.1);
      fy = feet - (back ? 0.42 : 0.26) * len;
      bend = len * 0.36;
    } else {
      fx = hipX + (back ? -2.1 : 1.1);
      fy = feet + 0.6;
      bend = 1.3;
    }
  } else if (Math.abs(b.vx) > 20) {
    // striding: the foot swings fore and aft, and lifts over the top of its arc
    const ph = b.walkPhase + (back ? Math.PI : 0);
    const up = Math.max(0, Math.cos(ph));
    fx = hipX + Math.sin(ph) * len * 0.44;
    fy = feet - up * len * 0.3;
    bend = 0.9 + up * len * 0.26;
  } else {
    fx = hipX + (back ? -1.1 : 1.3);
    fy = feet;
    bend = 1.1;
  }
  const kx = hipX + (fx - hipX) * 0.5 + bend;
  const ky = hipY + (fy - hipY) * 0.5;
  const col = back ? LIMB_DARK : ROOT;
  ctx.strokeStyle = col;
  ctx.lineCap = 'round';
  ctx.lineWidth = back ? 2.4 : 2.9;
  ctx.beginPath();
  ctx.moveTo(hipX, hipY);
  ctx.lineTo(kx, ky);
  ctx.lineTo(fx, fy);
  ctx.stroke();
  // the knot of a knee
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.arc(kx, ky, back ? 1.3 : 1.6, 0, TAU);
  ctx.fill();
  // three little roots for toes
  const toe = len * 0.26;
  ctx.lineWidth = back ? 1.5 : 1.8;
  ctx.beginPath();
  ctx.moveTo(fx - toe * 0.8, fy + 0.3);
  ctx.lineTo(fx, fy - 1.1);
  ctx.lineTo(fx + toe, fy + 0.3);
  ctx.moveTo(fx + toe * 0.2, fy - 0.9);
  ctx.lineTo(fx + toe * 0.45, fy + 0.4);
  ctx.stroke();
}

/** A twig arm from the shoulder at (x, y), at angle `a`, with a leaf for a hand. */
function arm(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, len: number, ink: string, back: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.strokeStyle = back ? LIMB_DARK : ROOT;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len, 0);
  ctx.stroke();
  ctx.translate(len, 0);
  ctx.rotate(-0.5);
  ctx.lineWidth = 1;
  leaf(ctx, 5.5, 2.6, back ? '#86b43a' : LEAF, ink);
  ctx.restore();
}

/** The big leaf held overhead in a glide, spinning gently as it carries the sprout down. */
function glideLeaf(ctx: CanvasRenderingContext2D, top: number, t: number, ink: string, size: number) {
  ctx.save();
  ctx.translate(0, top - 6);
  // (a twirl: the leaf's width breathes as it spins round)
  ctx.scale(0.55 + 0.45 * Math.abs(Math.cos(t * 9)), 1);
  ctx.rotate(Math.PI);
  ctx.lineWidth = 1.4;
  ctx.translate(-size / 2, 0);
  leaf(ctx, size, size * 0.32, LEAF, ink);
  ctx.restore();
  // its stem, down to the hands
  ctx.strokeStyle = LEAF_DARK;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, top - 6);
  ctx.lineTo(0, top + 2);
  ctx.stroke();
}

/** Arm angles for what the sprout is doing (0 = straight ahead, negative = up). */
function armPose(b: Bird): [number, number] {
  const walk = Math.sin(b.walkPhase);
  if (b.fluttering) return [-1.75, -1.4];
  if (b.hanging) return b.climbing ? [-1.6 + Math.sin(b.wingPhase * 2) * 0.35, -1.6 - Math.sin(b.wingPhase * 2) * 0.35] : [-1.65, -1.45];
  if (b.cling !== 0) return [-0.9, -0.5];
  if (b.dashT > 0) return [2.4, 2.6];
  if (b.anchored) return [0.35, 0.55];
  if (!b.grounded) return b.vy < 0 ? [-1.2, -0.9] : [-0.5, -0.2];
  return [0.9 + walk * 0.5, 1.2 - walk * 0.5];
}

/**
 * A sprout, drawn around its body centre like a bird was: tilted toward the vine while it hangs,
 * leaning back while it holds on, squashed and stretched by its springy `squash`. Both are little
 * twig folk on two jointed legs: the tall one a bark-grained torso and a round head under a crown of
 * leaves, the small one a seed that is head and body at once, with two leaves that flap like wings.
 */
export function drawSprout(ctx: CanvasRenderingContext2D, b: Bird, col: BirdColor, t: number, ink: string, hat: string, menu: boolean) {
  ctx.save();
  ctx.translate(b.x, b.y);
  if (b.ghost) {
    drawSpore(ctx, col, t);
    ctx.restore();
    return;
  }
  if (b.invuln > 0 && Math.floor(t * 14) % 2 === 0) ctx.globalAlpha = 0.45;
  const feet = b.h / 2;
  // a dash leaves a green swoosh behind
  if (b.dashT > 0) {
    const sp = Math.hypot(b.vx, b.vy) || 1;
    ctx.save();
    ctx.globalAlpha *= 0.35;
    ctx.strokeStyle = LEAF;
    ctx.lineWidth = b.h * 0.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo((-b.vx / sp) * 26, (-b.vy / sp) * 26);
    ctx.stroke();
    ctx.restore();
  }
  let rot = 0;
  const rope = b.rope;
  if (b.hanging && rope) rot = Math.atan2(rope.pivot.x - b.x, -(rope.pivot.y - b.y)) * 0.75;
  else if (b.anchored && rope) rot = -Math.sign(rope.pivot.x - b.x || b.facing) * 0.18;
  else if (b.cling !== 0) rot = b.cling * 0.12;
  else if (b.grounded && Math.abs(b.vx) > 40) rot = Math.sign(b.vx) * 0.06 + (b.strain > 0.3 ? Math.sign(b.vx) * 0.1 : 0);
  else if (!b.grounded) rot = clamp(b.vx / 1800, -0.22, 0.22);
  ctx.rotate(rot);
  // Squash around the feet: the springy impulse plus the lean of rising or falling. A landing takes
  // the full flattening — that's where the punch reads — but a stretch is given less height than it
  // takes width, or a tall sprout leaving the ground draws as a tube rather than a sprout.
  const sq = clamp(b.squash + b.airLean, -0.42, LAND_SQUASH_MAX);
  ctx.translate(0, feet);
  ctx.scale(b.facing * (1 + sq * 0.8), 1 - sq * (sq < 0 ? 0.72 : 1));
  ctx.translate(0, -feet);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const open = b.fluttering || b.dashT > 0 || b.strain > 0.5;
  if (b.kind === 'tall') drawTall(ctx, b, col, t, ink, feet, menu, open);
  else drawSeedling(ctx, b, col, t, ink, feet, menu, open, b.traits.art);
  if (hat !== 'none') {
    ctx.save();
    // (hats were drawn for a round head of radius 12 centred at 0)
    if (b.kind === 'tall') ctx.translate(0, -feet + 9);
    else {
      // hats were drawn for the seedling at scale 1, so they follow its art scale
      const k = b.traits.art * 0.69;
      ctx.translate(0, -feet + 9 * k);
      ctx.scale(k, k);
    }
    drawHat(ctx, hat, ink);
    ctx.restore();
  }
  // a bead of effort while straining against the vine
  if (b.strain > 0.5 && b.grounded) {
    ctx.fillStyle = '#9fdcff';
    ctx.beginPath();
    ctx.ellipse(-6, -feet + 2, 1.6, 2.4, -0.4, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The tall sprout: a twig fellow on two legs — a slim bark torso in its player's colour, a round bark
 * head under a crown of three leaves, twig arms with leaves for hands. Feet at y = feet.
 */
function drawTall(ctx: CanvasRenderingContext2D, b: Bird, col: BirdColor, t: number, ink: string, feet: number, menu: boolean, open: boolean) {
  const LEG = 11;
  const hipY = feet - LEG;
  const shoulderY = -1;
  const headY = -10;
  const crownY = headY - 8.4;
  const sway = Math.sin(t * 2.3 + b.idx) * 0.08 + clamp(-b.vx / 2500, -0.2, 0.2);
  if (b.fluttering) glideLeaf(ctx, crownY - 9, t, ink, 34);
  // the crown: three leaves on a short stem out of the top of its head
  ctx.save();
  ctx.translate(0, crownY);
  ctx.rotate(sway);
  ctx.lineWidth = 1.3;
  ctx.strokeStyle = LEAF_DARK;
  ctx.beginPath();
  ctx.moveTo(0, 3);
  ctx.lineTo(0, -4);
  ctx.stroke();
  for (let i = 0; i < CROWN.length; i++) {
    const a = CROWN[i][0];
    ctx.save();
    ctx.translate(0, -3.5);
    ctx.rotate(a + Math.sin(t * 3 + a) * 0.06);
    leaf(ctx, CROWN[i][1], 4.4, LEAF, ink);
    ctx.restore();
  }
  ctx.restore();
  const [aBack, aFront] = armPose(b);
  // the far arm and far leg go behind the body; the near ones in front of it
  arm(ctx, -3, shoulderY + 1.5, aBack + Math.PI, 8, ink, true);
  leg(ctx, b, -1, -3.4, hipY, feet, LEG);
  // the torso: slim, bark-grained, with moss on its hips
  const torso = () => {
    ctx.beginPath();
    ctx.moveTo(-6, hipY + 1.5);
    ctx.bezierCurveTo(-7.3, hipY - 3, -7.6, shoulderY + 3, -6.9, shoulderY - 1);
    ctx.quadraticCurveTo(0, shoulderY - 3.2, 6.9, shoulderY - 1);
    ctx.bezierCurveTo(7.6, shoulderY + 3, 7.3, hipY - 3, 6, hipY + 1.5);
    ctx.quadraticCurveTo(0, hipY + 3.4, -6, hipY + 1.5);
    ctx.closePath();
  };
  ctx.fillStyle = col.body;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.1;
  torso();
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = col.belly;
  ctx.beginPath();
  ctx.ellipse(2, (shoulderY + hipY) / 2 + 1, 5.2, 5.4, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.globalAlpha *= 0.7;
  ctx.lineWidth = 1.1;
  for (let i = 0; i < BARK.length; i++) {
    const x = BARK[i][0];
    const a = BARK[i][1];
    ctx.beginPath();
    ctx.moveTo(x, shoulderY + 2 + a * 2);
    ctx.bezierCurveTo(x + 1.3, shoulderY + 5, x - 1.1, hipY - 4, x + 0.5, hipY + 1 + a);
    ctx.stroke();
  }
  ctx.globalAlpha /= 0.7;
  // a patch of moss across its hips, soft and speckled
  ctx.fillStyle = 'rgba(140,196,62,0.85)';
  ctx.beginPath();
  ctx.ellipse(-2.4, hipY - 0.6, 5, 2.6, -0.2, 0, TAU);
  ctx.ellipse(3.4, hipY, 3.2, 1.9, 0.2, 0, TAU);
  ctx.fill();
  ctx.fillStyle = 'rgba(214,240,120,0.9)';
  for (let i = 0; i < MOSS.length; i++) {
    ctx.beginPath();
    ctx.arc(MOSS[i][0], hipY + MOSS[i][1], 0.75, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(40,20,60,0.12)';
  ctx.beginPath();
  ctx.ellipse(0, hipY + 2, 8, 3.5, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.1;
  torso();
  ctx.stroke();
  // a knot of a neck, then the head
  ctx.strokeStyle = ROOT;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(0.4, shoulderY - 1);
  ctx.lineTo(0.5, headY + 6);
  ctx.stroke();
  const head = () => {
    ctx.beginPath();
    ctx.ellipse(0.5, headY, 9.4, 8.8, 0, 0, TAU);
  };
  ctx.fillStyle = col.body;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.1;
  head();
  ctx.fill();
  ctx.save();
  ctx.clip();
  // a lighter grain across the face, and a knot in the bark of its cheek
  ctx.fillStyle = col.belly;
  ctx.beginPath();
  ctx.ellipse(2.6, headY - 0.4, 7, 6.6, 0, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = col.dark;
  ctx.globalAlpha *= 0.55;
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.ellipse(-5.6, headY + 1.6, 1.5, 2.1, 0.3, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-8.4, headY - 3);
  ctx.quadraticCurveTo(-5.6, headY - 1.4, -7.4, headY + 5);
  ctx.stroke();
  ctx.globalAlpha /= 0.55;
  ctx.restore();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.1;
  head();
  ctx.stroke();
  face(ctx, b, 2.6, headY - 1.2, 2.9, 7.2, ink, menu, open);
  arm(ctx, 5, shoulderY + 1.5, aFront, 8, ink, false);
  leg(ctx, b, 1, 3.4, hipY, feet, LEG);
}

/**
 * The small sprout (or, scaled, two sprouts alike): a twig child whose seed is head and body at once,
 * two seed leaves for hair, and short twig legs with root toes.
 */
function drawSeedling(ctx: CanvasRenderingContext2D, b: Bird, col: BirdColor, t: number, ink: string, feet: number, menu: boolean, open: boolean, k: number) {
  const LEG = 4.6 * k;
  const hipY = feet - LEG;
  const r = 7 * k;
  const cy = hipY - r * 0.82;
  if (b.fluttering) glideLeaf(ctx, cy - r - 10 * k, t, ink, 28 * k);
  // the two seed leaves: they flap like little wings in the air
  let flap = 0.35 + Math.sin(t * 2.4 + b.idx) * 0.06;
  if (b.fluttering || b.dashT > 0 || b.ghost) flap = 0.3 + Math.sin(b.wingPhase) * 0.55;
  else if (!b.grounded && !b.hanging) flap = b.vy < 0 ? 0.05 + Math.sin(b.wingPhase) * 0.4 : 0.75;
  else if (b.hanging) flap = 0.1;
  ctx.save();
  ctx.translate(0, cy - r + 1);
  ctx.strokeStyle = LEAF_DARK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.lineTo(0, -4 * k);
  ctx.stroke();
  ctx.translate(0, -4 * k);
  ctx.lineWidth = 1.1;
  for (let sI = 0; sI < 2; sI++) {
    const side = sI ? 1 : -1;
    ctx.save();
    ctx.scale(side, 1);
    ctx.rotate(-flap - 0.15);
    leaf(ctx, 9 * k, 3.6 * k, LEAF, ink);
    ctx.restore();
  }
  ctx.restore();
  const [aBack, aFront] = armPose(b);
  arm(ctx, -2 * k, cy + 1.5 * k, aBack + Math.PI, 4.5 * k, ink, true);
  leg(ctx, b, -1, -2.3 * k, hipY, feet, LEG);
  // the seed
  ctx.fillStyle = col.body;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, cy, r, r * 0.95, 0, 0, TAU);
  ctx.fill();
  ctx.save();
  ctx.clip();
  ctx.fillStyle = col.belly;
  ctx.beginPath();
  ctx.ellipse(2.4 * k, cy + 1.5 * k, 5.6 * k, 5.2 * k, -0.2, 0, TAU);
  ctx.fill();
  // a seed's speckles, and a soft shade underneath
  ctx.fillStyle = col.dark;
  ctx.globalAlpha *= 0.4;
  for (let i = 0; i < SPECKS.length; i++) {
    ctx.beginPath();
    ctx.arc(SPECKS[i][0] * k, cy + SPECKS[i][1] * k, 0.9 * k, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha /= 0.4;
  ctx.fillStyle = 'rgba(40,20,60,0.12)';
  ctx.beginPath();
  ctx.ellipse(0, cy + r, r + 3, 4, 0, 0, TAU);
  ctx.fill();
  ctx.restore();
  ctx.beginPath();
  ctx.ellipse(0, cy, r, r * 0.95, 0, 0, TAU);
  ctx.stroke();
  face(ctx, b, 2.2 * k, cy - 1.4 * k, 2.25 * k, 5 * k, ink, menu, open);
  arm(ctx, 3 * k, cy + 2 * k, aFront, 4.5 * k, ink, false);
  leg(ctx, b, 1, 2.3 * k, hipY, feet, LEG);
}

/** A sprout that's dropped out of play: a glowing seed drifting back to its partner. */
function drawSpore(ctx: CanvasRenderingContext2D, col: BirdColor, t: number) {
  glow(ctx, 0, 0, 18, hexRgb(col.belly), 0.85);
  glow(ctx, 0, 0, 9, '230,255,160', 0.7);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = col.body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 6.5 + Math.sin(t * 9) * 0.6, 7.5, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = LEAF;
  for (let sI = 0; sI < 2; sI++) {
    const side = sI ? 1 : -1;
    ctx.beginPath();
    ctx.ellipse(side * 3.5, -8.5, 3.6, 1.6, side * 0.5, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#2b2140';
  ctx.beginPath();
  ctx.arc(-2.2, -0.5, 1.1, 0, TAU);
  ctx.arc(2.2, -0.5, 1.1, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 1;
}
