import { isSolidTile, moverPos, Tile, type LevelData, type Pt } from './level';
import { CORNER_NUDGE, CRUMBLE_GONE, CRUMBLE_SHAKE, DOOR_HOLD, T } from './tuning';

/** Anything with a box that stands on things: the local birds and the partner's mirrored bird. */
export interface BodyLike {
  x: number;
  y: number;
  w: number;
  h: number;
  grounded: boolean;
  ghost: boolean;
}

export interface Body extends BodyLike {
  vx: number;
  vy: number;
  /** moving platform the body stands on (-1 none) */
  groundMover: number;
  /** > 0: falling through planks on purpose */
  dropT: number;
}

export type WorldEvent =
  | { k: 'crumble'; x: number; y: number }
  | { k: 'door'; group: number; open: boolean }
  | { k: 'plate'; x: number; y: number; down: boolean };

const enum Crumble {
  Intact = 0,
  Shaking = 1,
  Gone = 2,
}

/**
 * The live level: tiles plus everything that moves or changes (doors, plates, crumbling blocks,
 * moving platforms), and box-vs-tile movement for bodies. Moving platforms are a pure function of
 * the shared clock, so both screens see them in the same place.
 */
export class World {
  readonly L: LevelData;
  /** shared clock, seconds (host's clock online) */
  time = 0;
  readonly doorOpen: Float32Array;
  readonly doorSolid: Uint8Array;
  private readonly doorHold: Float32Array;
  private readonly doorWant: Uint8Array;
  readonly plateDown: Uint8Array;
  readonly crumbleState: Uint8Array;
  readonly crumbleT: Float32Array;
  readonly moverX: Float32Array;
  readonly moverY: Float32Array;
  readonly moverDX: Float32Array;
  readonly moverDY: Float32Array;
  readonly springT: Float32Array;
  readonly events: WorldEvent[] = [];
  private readonly tmp: Pt = { x: 0, y: 0 };
  private readonly hold: number;

  constructor(L: LevelData) {
    this.L = L;
    const g = Math.max(1, L.doorGroups);
    this.doorOpen = new Float32Array(g);
    this.doorSolid = new Uint8Array(g).fill(1);
    this.doorHold = new Float32Array(g);
    this.doorWant = new Uint8Array(g);
    this.plateDown = new Uint8Array(L.plates.length);
    this.crumbleState = new Uint8Array(L.crumbles.length);
    this.crumbleT = new Float32Array(L.crumbles.length);
    this.moverX = new Float32Array(L.movers.length);
    this.moverY = new Float32Array(L.movers.length);
    this.moverDX = new Float32Array(L.movers.length);
    this.moverDY = new Float32Array(L.movers.length);
    this.springT = new Float32Array(L.springs.length);
    this.hold = L.def.doorHold ?? DOOR_HOLD;
    this.placeMovers(0, true);
  }

  // ------------------------------------------------------------------ queries

  solidAt(tx: number, ty: number) {
    const L = this.L;
    if (tx < 0 || tx >= L.w) return true;
    if (ty < 0) return false;
    // below the map the bottom row carries on: solid columns stay solid, pits stay open
    if (ty >= L.h) return isSolidTile(L.tiles[(L.h - 1) * L.w + tx]);
    const i = ty * L.w + tx;
    const t = L.tiles[i];
    if (isSolidTile(t)) return true;
    if (t === Tile.Door) return this.doorSolid[L.doorAt[i]] === 1;
    if (t === Tile.Crumble) return this.crumbleState[L.crumbleAt[i]] !== Crumble.Gone;
    return false;
  }

  onewayAt(tx: number, ty: number) {
    const L = this.L;
    if (tx < 0 || tx >= L.w || ty < 0 || ty >= L.h) return false;
    return L.tiles[ty * L.w + tx] === Tile.Plank;
  }

  /** Solid at a world point (for the string's line-of-sight tests: static solids only). */
  staticSolidPx(x: number, y: number) {
    const L = this.L;
    const tx = Math.floor(x / T);
    const ty = Math.floor(y / T);
    if (tx < 0 || tx >= L.w) return true;
    if (ty < 0) return false;
    if (ty >= L.h) return isSolidTile(L.tiles[(L.h - 1) * L.w + tx]);
    return isSolidTile(L.tiles[ty * L.w + tx]);
  }

  /** Does a box overlap anything solid? */
  boxFree(x: number, y: number, w: number, h: number) {
    const x0 = Math.floor((x - w / 2 + 0.01) / T);
    const x1 = Math.floor((x + w / 2 - 0.01) / T);
    const y0 = Math.floor((y - h / 2 + 0.01) / T);
    const y1 = Math.floor((y + h / 2 - 0.01) / T);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) if (this.solidAt(tx, ty)) return false;
    return true;
  }

  /** Spikes touching a body (a little forgiving at the edges). */
  hazard(b: BodyLike) {
    const L = this.L;
    const l = b.x - b.w / 2 + 3;
    const r = b.x + b.w / 2 - 3;
    const t = b.y - b.h / 2 + 3;
    const bot = b.y + b.h / 2 - 1;
    const x0 = Math.max(0, Math.floor(l / T));
    const x1 = Math.min(L.w - 1, Math.floor(r / T));
    const y0 = Math.max(0, Math.floor(t / T));
    const y1 = Math.min(L.h - 1, Math.floor(bot / T));
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const tile = L.tiles[ty * L.w + tx];
        if (tile !== Tile.Spikes && tile !== Tile.CeilSpikes) continue;
        const sx0 = tx * T + 5;
        const sx1 = tx * T + T - 5;
        const sy0 = tile === Tile.Spikes ? ty * T + T * 0.5 : ty * T;
        const sy1 = tile === Tile.Spikes ? ty * T + T : ty * T + T * 0.5;
        if (r > sx0 && l < sx1 && bot > sy0 && t < sy1) return true;
      }
    }
    return false;
  }

  /** Falling past this is a fall out of the world — deep enough that a bird hanging on the full
   * string from the lowest ledge is still caught. */
  get floorY() {
    return (this.L.h + 11) * T;
  }

  // ------------------------------------------------------------------ movement

  /**
   * Move a body horizontally by dx, stopping at walls. Returns true when it hit one. A body that
   * already overlapped the column it moves into is only put back where it came from, never pushed
   * further the other way: "resolving" such an overlap against the move would shove it into the wall
   * behind it.
   */
  moveX(b: Body, dx: number) {
    if (dx === 0) return false;
    const from = b.x;
    b.x += dx;
    const hw = b.w / 2;
    const ty0 = Math.floor((b.y - b.h / 2 + 0.01) / T);
    const ty1 = Math.floor((b.y + b.h / 2 - 0.01) / T);
    if (dx > 0) {
      const tx = Math.floor((b.x + hw) / T);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (this.solidAt(tx, ty)) {
          b.x = Math.max(from, tx * T - hw - 0.001);
          return true;
        }
      }
    } else {
      const tx = Math.floor((b.x - hw) / T);
      for (let ty = ty0; ty <= ty1; ty++) {
        if (this.solidAt(tx, ty)) {
          b.x = Math.min(from, (tx + 1) * T + hw + 0.001);
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Move a body vertically by dy. Returns 1 when it landed (on ground, a plank or a moving platform),
   * -1 when it bumped a ceiling, 0 otherwise. Bumping a ceiling corner by a few pixels slides around it.
   */
  moveY(b: Body, dy: number): -1 | 0 | 1 {
    if (dy === 0) return 0;
    const hw = b.w / 2;
    const hh = b.h / 2;
    const prevBot = b.y + hh;
    b.y += dy;
    const left = b.x - hw + 0.01;
    const right = b.x + hw - 0.01;
    const tx0 = Math.floor(left / T);
    const tx1 = Math.floor(right / T);
    if (dy > 0) {
      const bot = b.y + hh;
      const ty = Math.floor(bot / T);
      let land = Infinity;
      let mover = -1;
      for (let tx = tx0; tx <= tx1; tx++) {
        if (this.solidAt(tx, ty)) land = Math.min(land, ty * T);
        else if (b.dropT <= 0 && this.onewayAt(tx, ty) && prevBot <= ty * T + 0.5) land = Math.min(land, ty * T);
      }
      if (b.dropT <= 0) {
        const movers = this.L.movers;
        for (let i = 0; i < movers.length; i++) {
          const mx = this.moverX[i];
          const my = this.moverY[i];
          // (against where its top was before this step: one rising into falling feet still catches them)
          if (right > mx && left < mx + movers[i].w && prevBot <= my + Math.max(0, -this.moverDY[i]) + 1 && bot >= my && my < land) {
            land = my;
            mover = i;
          }
        }
      }
      if (land < Infinity) {
        b.y = land - hh - 0.001;
        b.groundMover = mover;
        return 1;
      }
      return 0;
    }
    const top = b.y - hh;
    const ty = Math.floor(top / T);
    let blockedL = false;
    let blockedR = false;
    let blockedMid = false;
    for (let tx = tx0; tx <= tx1; tx++) {
      if (!this.solidAt(tx, ty)) continue;
      if (tx === tx0 && tx0 !== tx1) blockedL = true;
      else if (tx === tx1 && tx0 !== tx1) blockedR = true;
      else blockedMid = true;
    }
    if (!blockedL && !blockedR && !blockedMid) return 0;
    // clipped a corner: nudge sideways around it instead of stopping dead
    if (!blockedMid && blockedL !== blockedR) {
      const shift = blockedL ? (tx0 + 1) * T - left + 0.02 : tx1 * T - right - 0.02;
      if (Math.abs(shift) <= CORNER_NUDGE && this.boxFree(b.x + shift, b.y, b.w, b.h)) {
        b.x += shift;
        return 0;
      }
    }
    b.y = (ty + 1) * T + hh + 0.001;
    return -1;
  }

  /** Is the body standing on top of tile row `ty` across tile column `tx`? */
  standingOn(b: BodyLike, tx: number, ty: number) {
    if (!b.grounded || b.ghost) return false;
    const bot = b.y + b.h / 2;
    if (Math.abs(bot - ty * T) > 2.5) return false;
    return b.x + b.w / 2 > tx * T + 3 && b.x - b.w / 2 < tx * T + T - 3;
  }

  private overlapsTile(b: BodyLike, tx: number, ty: number) {
    if (b.ghost) return false;
    return b.x + b.w / 2 > tx * T && b.x - b.w / 2 < tx * T + T && b.y + b.h / 2 > ty * T && b.y - b.h / 2 < ty * T + T;
  }

  // ------------------------------------------------------------------ update

  private placeMovers(t: number, reset: boolean) {
    const ms = this.L.movers;
    for (let i = 0; i < ms.length; i++) {
      moverPos(ms[i], t, this.tmp);
      this.moverDX[i] = reset ? 0 : this.tmp.x - this.moverX[i];
      this.moverDY[i] = reset ? 0 : this.tmp.y - this.moverY[i];
      this.moverX[i] = this.tmp.x;
      this.moverY[i] = this.tmp.y;
    }
  }

  /** Jump the clock (online: the host's clock arrives, or snaps after a stall) without carrying anyone. */
  setTime(t: number) {
    this.time = t;
    this.placeMovers(t, true);
  }

  /** Advance moving platforms to shared time `t`; bodies standing on them are carried by moverDX/DY. */
  stepMovers(t: number) {
    this.time = t;
    this.placeMovers(t, false);
  }

  /** Plates, doors and crumbling blocks, given everyone who can stand on them this step. */
  stepDynamic(dt: number, bodies: readonly BodyLike[]) {
    const L = this.L;
    for (let i = 0; i < L.plates.length; i++) {
      const p = L.plates[i];
      let down = 0;
      for (const b of bodies) if (this.standingOn(b, p.tx, p.ty + 1)) down = 1;
      if (down !== this.plateDown[i]) {
        this.plateDown[i] = down;
        this.events.push({ k: 'plate', x: p.tx * T + T / 2, y: p.ty * T + T, down: !!down });
      }
    }
    for (let g = 0; g < this.doorOpen.length; g++) {
      // a gate opens while any of its plates is held (so each bird can hold it for the other)
      let want = false;
      for (let i = 0; i < L.plates.length; i++) if (L.plates[i].group === g && this.plateDown[i]) want = true;
      if (want) this.doorHold[g] = this.hold;
      else this.doorHold[g] = Math.max(0, this.doorHold[g] - dt);
      let open = want || this.doorHold[g] > 0;
      // never close a door on a bird standing in the doorway
      if (!open && this.doorOpen[g] > 0) {
        for (const d of L.doors) {
          if (d.group !== g) continue;
          for (const b of bodies) if (this.overlapsTile(b, d.tx, d.ty)) open = true;
        }
      }
      if (open !== !!this.doorWant[g]) {
        this.doorWant[g] = open ? 1 : 0;
        this.events.push({ k: 'door', group: g, open });
      }
      const o = this.doorOpen[g];
      this.doorOpen[g] = open ? Math.min(1, o + dt * 3.5) : Math.max(0, o - dt * 3.5);
      this.doorSolid[g] = this.doorOpen[g] < 0.45 ? 1 : 0;
    }
    for (let i = 0; i < L.crumbles.length; i++) {
      const c = L.crumbles[i];
      const st = this.crumbleState[i];
      if (st === Crumble.Intact) {
        for (const b of bodies) {
          if (this.standingOn(b, c.tx, c.ty)) {
            this.crumbleState[i] = Crumble.Shaking;
            this.crumbleT[i] = CRUMBLE_SHAKE;
            break;
          }
        }
      } else if (st === Crumble.Shaking) {
        this.crumbleT[i] -= dt;
        if (this.crumbleT[i] <= 0) {
          this.crumbleState[i] = Crumble.Gone;
          this.crumbleT[i] = CRUMBLE_GONE;
          this.events.push({ k: 'crumble', x: c.tx * T + T / 2, y: c.ty * T + T / 2 });
        }
      } else {
        this.crumbleT[i] -= dt;
        if (this.crumbleT[i] <= 0) {
          let blocked = false;
          for (const b of bodies) if (this.overlapsTile(b, c.tx, c.ty)) blocked = true;
          if (!blocked) this.crumbleState[i] = Crumble.Intact;
        }
      }
    }
    for (let i = 0; i < this.springT.length; i++) if (this.springT[i] > 0) this.springT[i] = Math.max(0, this.springT[i] - dt);
  }

  /** How far a crumbling block has shaken (0 intact .. 1 about to fall), or -1 when gone. */
  crumbleShake(i: number) {
    const st = this.crumbleState[i];
    if (st === Crumble.Gone) return -1;
    if (st === Crumble.Intact) return 0;
    return 1 - this.crumbleT[i] / CRUMBLE_SHAKE;
  }
}
