/**
 * The three bosses, as painted on the map beside their stops: Old Snip the crayfish (World 1), Rummage
 * the raccoon (World 2) and Jangle the jay (World 3). Drawn from the concept sheet in the game's ink
 * style, feet at (0, 0), in the sheet's own units (the tall sprout there is ~40 tall); drawBoss scales
 * them. Each is some hundred and fifty paths, so the map paints one once into a little canvas of its
 * own (portrait) and stamps that into its chunks.
 */
import type { BossArt } from '../game/worlds';

type P = number[];
let ctx: CanvasRenderingContext2D;
const TAU = Math.PI * 2;
const LW = 2.2;
let INK = '#24180f';

function ink(fill: string | null, inkCol: string | null = INK, lw = LW) {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (inkCol) {
    ctx.strokeStyle = inkCol;
    ctx.lineWidth = lw;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}
function ell(x: number, y: number, rx: number, ry: number, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
}
/** a smooth closed blob through points */
function blob(pts: P[]) {
  ctx.beginPath();
  const n = pts.length;
  const mid = (a: P, b: P) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m = mid(pts[n - 1], pts[0]);
  ctx.moveTo(m[0], m[1]);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    const mm = mid(p, q);
    ctx.quadraticCurveTo(p[0], p[1], mm[0], mm[1]);
  }
  ctx.closePath();
}
function poly(pts: P[]) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
}
/** an outlined limb: ink stroke under a coloured one */
function limb(pts: P[], w: number, col: string, inkCol = INK, curved = true) {
  const path = () => {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    if (curved && pts.length === 3) ctx.quadraticCurveTo(pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
    else for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
  };
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  path();
  ctx.strokeStyle = inkCol;
  ctx.lineWidth = w + LW * 2;
  ctx.stroke();
  path();
  ctx.strokeStyle = col;
  ctx.lineWidth = w;
  ctx.stroke();
}
function clipTo(shape: () => void, paint: () => void) {
  ctx.save();
  shape();
  ctx.clip();
  paint();
  ctx.restore();
}
function glowDot(x: number, y: number, r: number, rgb: string, a = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.35, `rgba(${rgb},${a * 0.45})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

// =====================================================================================
const SN = { body: '#c95a3e', light: '#ec8a66', dark: '#923a2a', far: '#a54731', farD: '#7c3224', tip: '#f4d8b2', moss: '#9cbc4a', mossD: '#6b8e2e', brow: '#f1ecd2', ink: '#2a1612' };
/** a pincer: palm at (0,0), fingers along +x; `open` in radians */
function chela(col: string, dark: string, light: string, open: number) {
  // fixed (lower) finger
  blob([[8, 3], [28, 6], [44, 2], [49, 5], [33, 14], [10, 13]]); ink(col);
  ctx.fillStyle = SN.tip; poly([[37, 4.2], [49, 5], [37, 11.5]]); ctx.fill();
  for (let k = 0; k < 4; k++) { poly([[12 + k * 6, 4.6], [15 + k * 6, 0.2], [18 + k * 6, 4.6]]); ink(SN.tip, SN.ink, LW * 0.6); }
  // moving (upper) finger
  ctx.save(); ctx.translate(8, -5); ctx.rotate(-open);
  blob([[0, 0], [20, -7], [38, -5], [43, -2], [27, 5], [3, 6]]); ink(col);
  ctx.fillStyle = SN.tip; poly([[32, -5.5], [43, -2], [33, 3.6]]); ctx.fill();
  for (let k = 0; k < 4; k++) { poly([[9 + k * 6, 5.2], [12 + k * 6, 9.5], [15 + k * 6, 5.2]]); ink(SN.tip, SN.ink, LW * 0.6); }
  ctx.restore();
  // palm
  ell(0, 2, 19, 14); ink(col);
  clipTo(() => ell(0, 2, 19, 14), () => { ctx.fillStyle = dark; ell(2, 15, 22, 8); ctx.fill(); ctx.fillStyle = light; ell(-3, -8, 11, 3); ctx.fill(); });
  ell(0, 2, 19, 14); ink(null);
  ctx.fillStyle = dark; for (const [x, y] of [[-7, 0], [2, 5], [9, -2], [-1, 8]]) { ell(x, y, 1.5, 1.5); ctx.fill(); }
}
function snip() {
  INK = SN.ink;
  // whip antennae, swept back over him
  limb([[44, -56], [30, -136], [-70, -120]], 1.4, SN.dark);
  limb([[52, -54], [56, -150], [-34, -156]], 1.5, SN.body);
  // legs
  for (let i = 0; i < 4; i++) {
    const hx = -12 + i * 12;
    limb([[hx, -20], [hx - 9, -10], [hx - 5 + (i - 1.5) * 2.5, 0]], 3.2, i % 2 ? SN.dark : SN.far, SN.ink, false);
  }
  // tail: four plates curling down, then the fan
  const segs: number[][] = [[-30, -36, 21, 31, 0.08], [-48, -31, 19, 28, 0.24], [-63, -22, 17, 25, 0.48], [-73, -10, 15, 22, 0.78]];
  ctx.save(); ctx.translate(-78, 2);
  for (const a of [0.55, 1.15, 1.75]) { ctx.save(); ctx.rotate(a + Math.PI / 2); ell(0, 11, 6.5, 12); ink(SN.body); ctx.restore(); }
  ctx.restore();
  for (let i = segs.length - 1; i >= 0; i--) {
    const [x, y, w, h, r] = segs[i];
    ctx.save(); ctx.translate(x, y); ctx.rotate(r);
    const plate = () => { ctx.beginPath(); ctx.roundRect(-w / 2, -h / 2, w, h, 7); };
    plate(); ink(SN.body);
    clipTo(plate, () => { ctx.fillStyle = SN.dark; ctx.fillRect(-w / 2, h * 0.12, w, h); ctx.fillStyle = SN.light; ctx.fillRect(-w / 2 + 3, -h / 2 + 2.5, w - 6, 3); });
    plate(); ink(null);
    ctx.restore();
  }
  // the far claw: behind his shell, raised high, a shade darker
  limb([[26, -46], [52, -70]], 9, SN.far);
  limb([[52, -70], [66, -86]], 8.5, SN.far);
  ctx.save(); ctx.translate(80, -100); ctx.rotate(-0.7); ctx.scale(0.9, 0.9); chela(SN.far, SN.farD, SN.body, 0.55); ctx.restore();
  // the carapace
  const shell = () => blob([[-36, -40], [-28, -62], [4, -70], [38, -62], [56, -46], [50, -24], [16, -16], [-28, -20]]);
  shell(); ink(SN.body);
  clipTo(shell, () => {
    ctx.fillStyle = SN.dark; ell(10, -10, 58, 17); ctx.fill();
    ctx.fillStyle = SN.light; ell(6, -64, 30, 5); ctx.fill();
    ctx.fillStyle = SN.dark; for (const [x, y] of [[-16, -42], [-8, -34], [24, -38], [34, -31], [12, -28], [42, -44]]) { ell(x, y, 1.7, 1.7); ctx.fill(); }
  });
  shell(); ink(null);
  ctx.beginPath(); ctx.moveTo(4, -68); ctx.quadraticCurveTo(-6, -42, 6, -19); ctx.strokeStyle = SN.ink; ctx.lineWidth = LW * 0.8; ctx.stroke();
  // moss on his back, and a tuft of grass: he's that old
  ctx.fillStyle = SN.moss;
  for (const [x, y, r] of [[-18, -60, 7], [-6, -66, 6.5], [9, -69, 7], [21, -66, 5.5], [-27, -50, 4.5]]) { ell(x, y, r, r * 0.72); ctx.fill(); }
  ctx.fillStyle = SN.mossD; for (const [x, y] of [[-16, -59], [-4, -65], [11, -68], [20, -65], [-9, -61], [-26, -50]]) { ell(x, y, 1.3, 1.1); ctx.fill(); }
  ctx.strokeStyle = SN.mossD; ctx.lineWidth = 1.5;
  for (const [x, a] of [[-1, -0.5], [2, -0.1], [5, 0.35]]) { ctx.beginPath(); ctx.moveTo(x, -70); ctx.quadraticCurveTo(x + 2 * Math.sin(a), -77, x + 8 * Math.sin(a), -82); ctx.stroke(); }
  // rostrum
  poly([[52, -52], [68, -47], [54, -40]]); ink(SN.body);
  // eye stalks, grumpy eyes, bushy brows
  for (const [bx, by, tx, ty] of [[42, -56, 40, -76], [52, -54, 58, -72]]) {
    limb([[bx, by], [tx, ty]], 3.4, SN.body);
    ell(tx, ty, 7, 7); ink('#ffffff');
    ell(tx + 2, ty + 1.8, 2.8, 3); ink('#1b1311', null);
    ctx.save(); ell(tx, ty, 7, 7); ctx.clip();
    ctx.fillStyle = SN.body; ctx.beginPath(); ctx.moveTo(tx - 8, ty - 8); ctx.lineTo(tx + 8, ty - 8); ctx.lineTo(tx + 8, ty - 0.6); ctx.lineTo(tx - 8, ty - 3.8); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(tx - 7, ty - 3.6); ctx.lineTo(tx + 7, ty - 0.7); ctx.strokeStyle = SN.ink; ctx.lineWidth = LW; ctx.stroke();
    ell(tx, ty, 7, 7); ink(null);
    ctx.save(); ctx.translate(tx, ty - 8.5); ctx.rotate(0.3);
    poly([[-9, 1], [-7, -3.5], [-3.5, -1], [-1, -5.5], [2, -2], [5.5, -6.5], [6.5, -1], [10, 0], [4.5, 2.8], [-4.5, 2.8]]); ink(SN.brow, SN.ink, LW * 0.8);
    ctx.restore();
  }
  // frown and whiskery mouthparts
  ctx.strokeStyle = SN.ink; ctx.lineWidth = LW;
  ctx.beginPath(); ctx.moveTo(53, -33); ctx.quadraticCurveTo(59, -37, 64, -32); ctx.stroke();
  ctx.strokeStyle = SN.brow; ctx.lineWidth = 1.7;
  for (const [x, y, dx] of [[55, -30, -5], [58.5, -29, 0], [62, -30, 5]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx * 0.5, y + 7); ctx.stroke(); }
  // the near claw: the snipper, held out low and open
  limb([[34, -26], [56, -26]], 10, SN.body);
  limb([[56, -26], [70, -38]], 10.5, SN.body);
  ctx.save(); ctx.translate(88, -48); ctx.rotate(-0.4); ctx.scale(1.12, 1.12); chela(SN.body, SN.dark, SN.light, 0.5); ctx.restore();
}

// =====================================================================================
// RUMMAGE — the raccoon who bottles the fireflies. Faces us. Feet at (0,0).
// =====================================================================================
const RC = { fur: '#8f919c', light: '#c6c7cf', dark: '#5f616d', mask: '#2b2a32', white: '#eeeef2', paw: '#3a3943', ink: '#1d1b24', lid: '#b89a5e', lidD: '#8a713f' };
function rummage(fireflies = true) {
  INK = RC.ink;
  // tail: one thick stroke, ringed with a dash pattern
  const tail = () => { ctx.beginPath(); ctx.moveTo(-36, -62); ctx.bezierCurveTo(-110, -60, -122, -150, -82, -196); };
  ctx.lineCap = 'round';
  tail(); ctx.strokeStyle = RC.ink; ctx.lineWidth = 40 + LW * 2; ctx.stroke();
  tail(); ctx.strokeStyle = RC.light; ctx.lineWidth = 40; ctx.stroke();
  ctx.save(); ctx.setLineDash([15, 13]); ctx.lineDashOffset = -6; ctx.lineCap = 'butt';
  tail(); ctx.strokeStyle = RC.dark; ctx.lineWidth = 40; ctx.stroke(); ctx.restore();
  ctx.fillStyle = RC.mask; ell(-82, -196, 19, 19); ctx.fill(); ctx.strokeStyle = RC.ink; ctx.lineWidth = LW; ctx.stroke();
  ctx.lineCap = 'round';
  // feet
  for (const s of [-1, 1]) {
    ell(s * 30, -22, 24, 22); ink(RC.dark);
    ell(s * 34, -6, 27, 9); ink(RC.paw);
    ctx.fillStyle = '#55545f'; for (let k = -1; k <= 1; k++) { ell(s * 34 + k * 9 + s * 6, -9, 3, 2); ctx.fill(); }
  }
  // body
  const body = () => blob([[-52, -176], [-74, -120], [-76, -60], [-46, -24], [0, -18], [46, -24], [76, -60], [74, -120], [52, -176], [0, -186]]);
  body(); ink(RC.fur);
  clipTo(body, () => {
    ctx.fillStyle = RC.light; ell(0, -92, 48, 64); ctx.fill();
    ctx.fillStyle = RC.dark; ell(-70, -60, 22, 60); ctx.fill(); ell(70, -60, 22, 60); ctx.fill();
  });
  body(); ink(null);
  // upper arms
  limb([[-58, -168], [-80, -132], [-46, -104]], 24, RC.fur);
  limb([[58, -168], [80, -132], [46, -104]], 24, RC.fur);
  // the jar
  const jar = () => { ctx.beginPath(); ctx.roundRect(-36, -152, 72, 88, 14); };
  jar(); ctx.fillStyle = 'rgba(214,240,236,0.55)'; ctx.fill();
  if (fireflies) {
    let s = 7;
    const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
    clipTo(jar, () => {
      ctx.fillStyle = 'rgba(232,255,120,0.18)'; ctx.fillRect(-36, -152, 72, 88);
      for (let k = 0; k < 16; k++) {
        const x = -28 + r() * 56, y = -144 + r() * 74;
        glowDot(x, y, 12, '236,255,130', 0.9);
        ctx.fillStyle = '#fffbd8'; ell(x, y, 2.2, 2.2); ctx.fill();
        ctx.fillStyle = '#3b3a2a'; ell(x - 1.6, y - 1.4, 1.3, 1.1); ctx.fill();
      }
    });
  }
  jar(); ink(null);
  // glints
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(-25, -138); ctx.lineTo(-25, -96); ctx.stroke();
  ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(-17, -140); ctx.lineTo(-17, -128); ctx.stroke();
  // neck and lid, tied with string
  ctx.beginPath(); ctx.roundRect(-27, -162, 54, 12, 4); ink('rgba(214,240,236,0.7)');
  ctx.beginPath(); ctx.roundRect(-32, -174, 64, 14, 5); ink(RC.lid);
  ctx.strokeStyle = RC.lidD; ctx.lineWidth = 1.6; for (let k = -24; k <= 24; k += 8) { ctx.beginPath(); ctx.moveTo(k, -172); ctx.lineTo(k, -162); ctx.stroke(); }
  // paws gripping the jar
  for (const s of [-1, 1]) {
    ell(s * 38, -106, 13, 17, s * 0.2); ink(RC.paw);
    for (let k = 0; k < 3; k++) { ell(s * 30, -118 + k * 9, 5.5, 3.8); ink(RC.paw, RC.ink, LW * 0.8); }
  }
  // head
  // ears
  for (const s of [-1, 1]) {
    blob([[s * 26, -250], [s * 46, -294], [s * 64, -248]]); ink(RC.fur);
    blob([[s * 34, -254], [s * 46, -282], [s * 57, -253]]); ink(RC.mask, null);
    ctx.strokeStyle = RC.white; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(s * 33, -262); ctx.quadraticCurveTo(s * 44, -296, s * 58, -258); ctx.stroke();
  }
  // face shape with cheek ruffs
  const head = () => blob([[-30, -258], [0, -264], [30, -258], [56, -238], [68, -214], [78, -200], [62, -194], [70, -184], [48, -180], [24, -172], [0, -170], [-24, -172], [-48, -180], [-70, -184], [-62, -194], [-78, -200], [-68, -214], [-56, -238]]);
  head(); ink(RC.fur);
  clipTo(head, () => { ctx.fillStyle = RC.light; ell(0, -178, 60, 18); ctx.fill(); });
  head(); ink(null);
  // white brows
  for (const s of [-1, 1]) { blob([[s * 10, -244], [s * 26, -252], [s * 46, -246], [s * 40, -238], [s * 14, -238]]); ink(RC.white, null); }
  // the mask
  blob([[-62, -214], [-46, -238], [-22, -236], [0, -226], [22, -236], [46, -238], [62, -214], [52, -200], [26, -204], [0, -196], [-26, -204], [-52, -200]]);
  ink(RC.mask);
  // muzzle
  blob([[-24, -206], [0, -214], [24, -206], [28, -190], [14, -178], [0, -176], [-14, -178], [-28, -190]]); ink(RC.white);
  // nose
  blob([[-9, -206], [9, -206], [4, -198], [-4, -198]]); ink('#1a191f');
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ell(-3, -204, 2.5, 1.3); ctx.fill();
  // eyes: sly, half shut, looking to his left (our right)
  for (const s of [-1, 1]) {
    const ex = s * 28, ey = -220;
    ell(ex, ey, 9.5, 8); ink('#ffffff', null);
    ctx.fillStyle = '#1b1a20'; ell(ex + 3.2, ey + 1.2, 4.6, 5); ctx.fill();
    ctx.fillStyle = '#ffffff'; ell(ex + 1.6, ey - 0.6, 1.5, 1.5); ctx.fill();
    ctx.save(); ell(ex, ey, 9.5, 8); ctx.clip();
    ctx.fillStyle = RC.mask; ctx.beginPath(); ctx.moveTo(ex - 12, ey - 10); ctx.lineTo(ex + 12, ey - 10); ctx.lineTo(ex + 12, ey - 1 + s * 1.5); ctx.lineTo(ex - 12, ey - 1 - s * 1.5); ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.strokeStyle = '#6d6c78'; ctx.lineWidth = LW * 0.9; ctx.beginPath(); ctx.moveTo(ex - 10, ey - 1 - s * 1.6); ctx.lineTo(ex + 10, ey - 1 + s * 1.6); ctx.stroke();
  }
  // grin with one tooth
  ctx.strokeStyle = RC.ink; ctx.lineWidth = LW;
  ctx.beginPath(); ctx.moveTo(-14, -188); ctx.quadraticCurveTo(2, -180, 18, -192); ctx.stroke();
  poly([[6, -184.5], [12, -186.5], [9.5, -180]]); ink('#ffffff', RC.ink, LW * 0.7);
  ctx.beginPath(); ctx.moveTo(18, -192); ctx.lineTo(21, -195); ctx.stroke();
}

// =====================================================================================
// JANGLE — the jay who stole the seed. Faces left, perched, the seed in her beak. Feet at (0,0).
// =====================================================================================
const JY = { body: '#d9a38c', light: '#f1d4c4', dark: '#b97f69', wing: '#2a2f44', blue: '#3d8ff0', navy: '#1a2b63', white: '#f6f2ee', beak: '#3a3c45', leg: '#caa197', ink: '#21161a', seed: '#ffcd38', seedL: '#fff4b8', branch: '#8a5a34' };
function jangle() {
  INK = JY.ink;
  // the branch
  limb([[-78, 4], [-10, 0], [70, 8]], 11, JY.branch);
  ctx.save(); ctx.translate(56, 6); ctx.rotate(-0.6); ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(9, -9, 20, 0); ctx.quadraticCurveTo(9, 7, 0, 0); ink('#a8d64a'); ctx.restore();
  // tail
  poly([[14, -42], [30, -48], [66, -12], [54, -2]]); ink(JY.wing);
  ctx.strokeStyle = JY.navy; ctx.lineWidth = 1.2; for (let k = 1; k < 4; k++) { ctx.beginPath(); ctx.moveTo(22 + k * 9, -40 + k * 8.5); ctx.lineTo(30 + k * 9, -46 + k * 9); ctx.stroke(); }
  ell(20, -38, 9, 7, 0.5); ink(JY.white);
  // legs gripping the branch
  for (const x of [-10, 4]) {
    limb([[x, -20], [x - 2, -2]], 3.2, JY.leg);
    for (const dx of [-5, 0, 5]) limb([[x - 2, -1], [x - 2 + dx, 3]], 2.2, JY.leg);
  }
  // body, chest out
  const body = () => blob([[-30, -92], [-42, -60], [-32, -26], [0, -16], [28, -26], [38, -56], [26, -86], [0, -98]]);
  body(); ink(JY.body);
  clipTo(body, () => { ctx.fillStyle = JY.light; ell(-16, -50, 24, 31, 0.15); ctx.fill(); ctx.fillStyle = JY.dark; ell(16, -22, 30, 12); ctx.fill(); });
  body(); ink(null);
  // folded wing with the barred blue patch
  const wing = () => blob([[2, -84], [24, -80], [36, -58], [40, -32], [46, -10], [30, -20], [12, -44], [0, -66]]);
  wing(); ink(JY.wing);
  clipTo(wing, () => {
    const cols = [JY.blue, JY.navy, JY.white, JY.blue, JY.navy, JY.blue, JY.navy];
    for (let k = 0; k < 7; k++) { ctx.fillStyle = cols[k]; ctx.save(); ctx.translate(13 + k * 1.2, -80 + k * 3.6); ctx.rotate(-0.25); ctx.fillRect(-14, -1.8, 30, 3.6); ctx.restore(); }
    ctx.fillStyle = JY.white; ell(30, -36, 5, 8, -0.4); ctx.fill();
  });
  wing(); ink(null);
  // crest: a soft raised tuft, streaked
  for (const [x, y, a, l, w] of [[-20, -122, -0.05, 15, 6], [-12, -124, 0.35, 17, 6.5], [-4, -121, 0.75, 16, 6], [2, -116, 1.1, 13, 5]]) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(a - Math.PI / 2);
    ctx.beginPath(); ctx.moveTo(0, -w); ctx.quadraticCurveTo(l * 0.75, -w, l, 0); ctx.quadraticCurveTo(l * 0.75, w, 0, w); ink(JY.body);
    ctx.strokeStyle = '#2a2224'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(4, 0); ctx.lineTo(l * 0.78, 0); ctx.stroke();
    ctx.restore();
  }
  // head
  const head = () => ell(-12, -104, 25, 23);
  head(); ink(JY.body);
  clipTo(head, () => {
    ctx.fillStyle = JY.white; ell(-30, -90, 16, 13); ctx.fill();
    ctx.strokeStyle = '#2a2224'; ctx.lineWidth = 1.2;
    for (const [x, y] of [[-16, -125], [-9, -124], [-2, -121], [-21, -121], [-12, -119], [-5, -117]]) { ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + 2, y + 5); ctx.stroke(); }
  });
  head(); ink(null);
  // moustache stripe
  ctx.fillStyle = '#1e1a1e'; ctx.beginPath(); ctx.moveTo(-35, -98); ctx.quadraticCurveTo(-34, -84, -18, -78); ctx.quadraticCurveTo(-24, -86, -27, -98); ctx.closePath(); ctx.fill();
  // the seed, held crosswise in her beak, glowing
  const sx = -60, sy = -99;
  glowDot(sx, sy, 34, '255,214,90', 0.7);
  // beak: closed on the seed
  poly([[-35, -106], [-57, -101], [-35, -96]]); ink(JY.beak);
  ctx.save(); ctx.translate(sx, sy); ctx.rotate(0.15);
  ctx.beginPath(); ctx.moveTo(-12, 0); ctx.bezierCurveTo(-7, -9, 7, -9, 12, 0); ctx.bezierCurveTo(7, 9, -7, 9, -12, 0); ink(JY.seed);
  ctx.fillStyle = JY.seedL; ell(-2, -3.5, 5, 2.2); ctx.fill();
  ctx.strokeStyle = '#d9a21a'; ctx.lineWidth = 1.1; ctx.beginPath(); ctx.moveTo(-9, 0.5); ctx.quadraticCurveTo(0, 3.5, 9, 0.5); ctx.stroke();
  ctx.restore();
  poly([[-35, -100], [-54, -100], [-35, -95]]); ink(JY.beak);
  for (const [x, y, r] of [[-78, -116, 2.1], [-46, -124, 1.6], [-80, -86, 1.5]]) { ctx.fillStyle = '#fff6c8'; ctx.beginPath(); ctx.moveTo(x, y - r * 2.5); ctx.lineTo(x + r * 0.6, y); ctx.lineTo(x, y + r * 2.5); ctx.lineTo(x - r * 0.6, y); ctx.closePath(); ctx.fill(); ctx.beginPath(); ctx.moveTo(x - r * 2.5, y); ctx.lineTo(x, y - r * 0.6); ctx.lineTo(x + r * 2.5, y); ctx.lineTo(x, y + r * 0.6); ctx.closePath(); ctx.fill(); }
  // eye: pale blue iris, smug lid, a sidelong look back at you
  const ex = -19, ey = -109;
  ell(ex, ey, 8.5, 8.5); ink('#d6eaff');
  ctx.fillStyle = '#16131a'; ell(ex + 2.2, ey + 0.8, 3.8, 3.8); ctx.fill();
  ctx.fillStyle = '#fff'; ell(ex + 1, ey - 0.6, 1.3, 1.3); ctx.fill();
  ctx.save(); ell(ex, ey, 8.5, 8.5); ctx.clip();
  ctx.fillStyle = JY.body; ctx.beginPath(); ctx.moveTo(ex - 10, ey - 10); ctx.lineTo(ex + 10, ey - 10); ctx.lineTo(ex + 10, ey - 1.5); ctx.lineTo(ex - 10, ey - 3.5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = JY.ink; ctx.lineWidth = LW; ctx.beginPath(); ctx.moveTo(ex - 8.5, ey - 3.4); ctx.lineTo(ex + 8.5, ey - 1.6); ctx.stroke();
  ell(ex, ey, 8.5, 8.5); ink(null);
  ctx.fillStyle = 'rgba(255,120,140,0.35)'; ell(-26, -93, 5, 3); ctx.fill();
}


/** Each boss's extent round its feet, in the sheet's units: [left, top, right, bottom]. */
export const BOSS_BOX: Record<BossArt, [number, number, number, number]> = {
  snip: [-106, -168, 146, 10],
  rummage: [-128, -300, 84, 6],
  jangle: [-96, -146, 82, 16],
};

/** How big each is drawn on the map (× the sheet). */
export const BOSS_SCALE: Record<BossArt, number> = { snip: 0.36, rummage: 0.27, jangle: 0.4 };

/** Draw a boss, feet at the origin, in the sheet's units (scale the context first). */
export function drawBoss(g: CanvasRenderingContext2D, art: BossArt) {
  ctx = g;
  g.save();
  if (art === 'snip') snip();
  else if (art === 'rummage') rummage();
  else jangle();
  g.restore();
}

const portraits = new Map<string, HTMLCanvasElement>();

/**
 * A boss painted once into a canvas of its own, at `k` device pixels per map unit — in its colours, or
 * as a dark shape (a boss not met yet). Returns the canvas and where its top-left corner sits, in map
 * units from the boss's feet.
 */
export function portrait(art: BossArt, k: number, shade: boolean): { c: HTMLCanvasElement; x: number; y: number; w: number; h: number } {
  const s = BOSS_SCALE[art];
  const [l, t, r, b] = BOSS_BOX[art];
  const x = l * s;
  const y = t * s;
  const w = (r - l) * s;
  const h = (b - t) * s;
  const key = `${art}:${shade ? 1 : 0}:${k.toFixed(3)}`;
  let c = portraits.get(key);
  if (!c) {
    if (portraits.size > 24) portraits.clear();
    c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(w * k));
    c.height = Math.max(1, Math.ceil(h * k));
    // (on the CPU, like the chunks it's stamped into: a GPU canvas drawn into a CPU one is a readback)
    const g = c.getContext('2d', { willReadFrequently: true })!;
    g.setTransform(k * s, 0, 0, k * s, -l * k * s, -t * k * s);
    drawBoss(g, art);
    if (shade) {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalCompositeOperation = 'source-atop';
      g.fillStyle = 'rgba(38,34,52,0.86)';
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = 'source-over';
    }
    portraits.set(key, c);
  }
  return { c, x, y, w, h };
}
