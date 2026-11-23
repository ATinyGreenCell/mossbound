// Moving around the menus, quickly and safely: the highlight moves in the frame that moved it; a held
// direction repeats (in menus, never on a menu that opened under it); on the map the arrows walk the pair;
// the waits after a clear, in the lobby and on "together!" are short; LEAVE ROOM asks before it ends the
// game for both; the Ⓐ that hands an Xbox's controllers over presses nothing; and a controller reaches
// every part of settings (your name, the save code, connection help).
//
// Timings are read off the frames the game draws, never off sleeps: a frame's own clock when it ran. Every
// hold and every wait lasts a stretch of time AND a number of frames, so a machine drawing three frames a
// second (the CI gate: software rendering) is asked the same questions as one drawing sixty.
import { BASE, XBOX_UA, frames, gameTime, launch, mapHere, mapStill, open, padPress, reporter, screenName, storyOpen, waitFor } from './harness.mjs';

const browser = await launch();
const t = reporter();
const errors = [];
const done = async (page) => {
  errors.push(...page.errors);
  await page.close();
};
const A = 0, B = 1, START = 9, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;
const key = async (page, k) => { await page.keyboard.press(k); await frames(page, 2); };
/** Wait `ms` and at least `n` frames: a menu's own guards count both (see menu.ts). */
const settle = (page, ms, n = 4) => page.evaluate((ms, n) => new Promise((done) => {
  const t0 = performance.now();
  let k = 0;
  const f = () => (++k >= n && performance.now() - t0 >= ms ? done() : requestAnimationFrame(f));
  requestAnimationFrame(f);
}), ms, n);
const selAct = (page, scope = '') => page.evaluate((scope) => { const el = document.querySelector(`${scope} .sel`); return el ? el.dataset.act ?? el.tagName : null; }, scope);
/** The same page at the game's own pace: no ?fast, so the waits measured are the ones players get. */
const realtime = async (page) => {
  await page.goto(`${BASE}?noaudio`, { waitUntil: 'networkidle0' });
  await waitFor(() => page.evaluate(() => !!window.__fb?.app?.current), 20000, 'boot (real time)');
};
/**
 * Installs window.__hold(how, ms, sample, n = 8): from the next frame, holds a direction — a pad button
 * ('pad:0:13'), the left stick ('stick:0:0.9' — down) or a key ('key:ArrowDown') — for `ms` and at
 * least `n` frames, and reads `sample()` (a string of JS) once a frame after the game's own frame.
 * Resolves to [{ at, v }]: when (ms after the frame that pressed) and what.
 */
const installHold = (page) => page.evaluate(() => {
  const setter = (how) => {
    const [kind, a, b] = how.split(':');
    return (on) => {
      if (kind === 'pad') window.__pads[+a].buttons[+b] = { pressed: on, touched: on, value: on ? 1 : 0 };
      else if (kind === 'stick') window.__pads[+a].axes[1] = on ? +b : 0;
      else window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code: a, key: a, bubbles: true }));
    };
  };
  /**
   * window.__holdInto(how, button, ready, sample): holds a direction from the next frame; on the first
   * frame `ready` (JS, with t = ms and n = frames into the hold) is true, presses pad 0's `button` for two
   * frames, which opens a menu; keeps the direction held while that menu is up for 700 ms and at least
   * four frames — time and frames enough for a repeat to show at any frame rate — then lets go. Resolves
   * to what `sample` read on each frame the menu was up ('none' while it isn't), and for how long.
   */
  window.__holdInto = (how, button, ready, sample) => new Promise((done) => {
    const isReady = new Function('t', 'n', `return (${ready});`);
    const read = new Function(`return (${sample});`);
    const set = setter(how);
    const tap = (on) => { window.__pads[0].buttons[button] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
    const seen = [];
    let t0 = -1;
    let n = 0;
    let tapped = -1;
    let upAt = 0;
    const deadline = performance.now() + 60000;
    const f = () => {
      const now = performance.now();
      if (t0 < 0) {
        set(true);
        t0 = now;
        return requestAnimationFrame(f);
      }
      n++;
      if (tapped < 0 && isReady(now - t0, n)) {
        tap(true);
        tapped = n;
      } else if (tapped >= 0 && n === tapped + 2) tap(false);
      const v = read();
      if (v !== 'none') {
        upAt ||= now;
        seen.push(v);
      }
      if ((upAt && seen.length >= 4 && now - upAt >= 700) || now > deadline) {
        set(false);
        tap(false);
        return requestAnimationFrame(() => requestAnimationFrame(() => done({ seen, frames: seen.length, ms: Math.round(upAt ? now - upAt : 0) })));
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  window.__hold = (how, ms, sample, n = 8) => new Promise((done) => {
    const read = new Function(`return (${sample});`);
    const set = setter(how);
    const out = [];
    let t0 = -1;
    let held = 0;
    const f = () => {
      const now = performance.now();
      if (t0 < 0) {
        out.push({ at: 0, v: read() });
        set(true);
        t0 = now;
      } else out.push({ at: Math.round(now - t0), v: read() });
      if (t0 >= 0 && ++held > n && now - t0 >= ms) {
        set(false);
        requestAnimationFrame(() => requestAnimationFrame(() => done(out)));
        return;
      }
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
});
/**
 * The moves in a run of samples: when the value changed (ms, and which frame), and the longest frame
 * seen — the grain every timing here is read to.
 */
const movesOf = (samples) => {
  const at = [];
  const idx = [];
  let frame = 0;
  for (let i = 1; i < samples.length; i++) {
    frame = Math.max(frame, samples[i].at - samples[i - 1].at);
    if (samples[i].v !== samples[i - 1].v) {
      at.push(samples[i].at);
      idx.push(i);
    }
  }
  const gaps = at.slice(1).map((x, i) => x - at[i]);
  return { n: at.length, at, idx, first: gaps[0] ?? null, rest: gaps.slice(1), frame: Math.round(frame) };
};
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
/**
 * A held direction: one move at once; the next no sooner than ~350 ms and two frames on (a tap that
 * spans one slow frame is still a tap), and soon after that; then about eight a second — or one a
 * frame, where frames are slower than that.
 */
const repeats = (m) => {
  const F = m.frame;
  return m.n >= 4 && m.idx[1] - m.idx[0] >= 2 && m.first >= 350 - F && m.first <= Math.max(350, 2 * F) + F + 30 && mean(m.rest) >= 105 && mean(m.rest) <= Math.max(150, F + 20);
};
const guestRoom = (page, role = 'guest') => page.evaluate((role) => {
  const l = {
    role, code: 'K7QX', status: 'connected', detail: '', rtt: 40, via: 'direct', peerId: 'p', peerGen: 1, myId: 'me', closed: false,
    onStatus: null, onCtrl: null, onSnap: null,
    get connected() { return this.status === 'connected'; },
    sharedNow() { return performance.now(); },
    send() {},
    sendSnap() { return true; },
    close() { this.closed = true; this.status = 'lost'; },
  };
  window.__link = l;
  window.__fb.flow.link = l;
  window.__fb.flow.mode = 'online';
}, role);
const SAVE = { unlocked: 6, levels: {}, finished: false, run: { level: 1, cp: 0, seeds: [1], feathers: 0, time: 30, with: 'Pip & Bo' }, runAt: 1 };

// ---- 9. the highlight moves in the frame that moved it: no fade or glide on a button or a card (a
// transition running is a highlight still on its way) — while a press still sinks the button it's on
{
  const page = await open(browser, { storage: { 'mossbound.save.v2': SAVE } });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await settle(page, 450);
  const look = (scope, code) => page.evaluate((scope, code) => new Promise((done) => {
    requestAnimationFrame(() => {
      for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
      // the game's next frame moves the highlight; this reads what that frame shows
      requestAnimationFrame(() => {
        const sel = document.querySelector(`${scope} .sel`);
        const cs = sel ? getComputedStyle(sel) : null;
        const moving = document.getAnimations().filter((a) => a instanceof CSSTransition && a.effect?.target?.closest?.('.ui')).map((a) => `${a.effect.target.className}:${a.transitionProperty}`);
        done({ sel: sel?.dataset.act ?? sel?.textContent ?? null, moving, background: cs?.backgroundColor, transform: cs?.transform });
      });
    });
  }), scope, code);
  const btn = await look('.title-screen', 'ArrowDown');
  t.check('a button takes the highlight in the frame that moved it (no fade, no glide)', btn.sel === 'local' && !btn.moving.length && btn.background === 'rgb(255, 210, 122)' && btn.transform === 'matrix(1.05, 0, 0, 1.05, 0, 0)', btn);
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.levels(); });
  await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'levels');
  await settle(page, 400);
  // the level select is the map: the arrows walk the pair (no highlight to move), and the card follows
  // them the frame they stop, with no fade (map.mjs covers the map itself)
  if (await storyOpen(page)) {
    await gameTime(page, 0.4);
    await key(page, 'Enter');
    await gameTime(page, 0.5);
  }
  // (the run under way is in Fern Falls, so that's where the map opens: ← is Mossy Creek)
  const from = await mapHere(page);
  await key(page, 'ArrowLeft');
  await mapStill(page);
  const walked = await page.evaluate(() => ({ here: window.__fb.app.current.map.here, sel: document.querySelector('.map-screen .sel')?.dataset.act ?? null, card: document.querySelector('.map-screen .ow-card')?.textContent ?? '', fading: document.getAnimations().filter((a) => a instanceof CSSTransition && a.effect?.target?.closest?.('.map-screen')).map((a) => a.transitionProperty) }));
  t.check('on the map the arrows walk the pair, not a highlight', walked.here !== from && walked.sel === null, { from, ...walked });
  t.check('…and its card says where they stopped, at once (no fade)', /Mossy Creek/.test(walked.card) && !walked.fading.length, walked);
  // a press still answers: the button under a held mouse sinks a little, smoothly
  await page.evaluate(() => window.__fb.flow.title());
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 4000, 'title again');
  await settle(page, 450);
  const at = await page.evaluate(() => { const r = document.querySelectorAll('.title-screen .menu > .btn')[3].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.move(at.x, at.y);
  await frames(page, 2);
  await page.mouse.down();
  await frames(page, 1);
  const pressed = await page.evaluate(() => { const el = document.querySelectorAll('.title-screen .menu > .btn')[3]; const cs = getComputedStyle(el); return { active: el.matches(':active'), property: cs.transitionProperty, duration: cs.transitionDuration }; });
  await page.mouse.move(at.x, 4);
  await page.mouse.up();
  t.check('a pressed button still sinks under the press', pressed.active && pressed.property === 'transform' && pressed.duration === '0.08s', pressed);
  await done(page);
}

// ---- 10. a direction held in a menu moves again after ~350 ms, then about 8 times a second — from a
// d-pad, a stick or a key; a setting's value steps the same way, but a switch flips once per press;
// and a menu that opens under a direction already held (a sprout walking into the pause menu) waits for
// it to be pressed again
{
  const page = await open(browser, { pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await settle(page, 450);
  await installHold(page);
  const TITLE = 'window.__fbTitle.list.sel';
  const pad = movesOf(await page.evaluate((s) => window.__hold('pad:0:13', 1000, s), TITLE));
  t.check('a d-pad held in a menu repeats: after ~350 ms, then ~8 a second', repeats(pad), pad);
  await frames(page, 3);
  const keyHold = movesOf(await page.evaluate((s) => window.__hold('key:ArrowDown', 1000, s), TITLE));
  t.check('a key held in a menu repeats the same way', repeats(keyHold), keyHold);
  await frames(page, 3);
  const stick = movesOf(await page.evaluate((s) => window.__hold('stick:0:0.9', 1000, s), TITLE));
  t.check('a stick held in a menu repeats the same way', repeats(stick), stick);
  await frames(page, 3);
  // ↓ still held as Ⓐ opens SETTINGS (a new card on the same screen): the card doesn't scroll under it.
  // (↓ walks the highlight onto SETTINGS; Ⓐ goes down in the frame that shows it there)
  await page.evaluate(() => { const L = window.__fbTitle.list; L.sel = 3; L.highlight(); });
  const opening = await page.evaluate(() => window.__holdInto('pad:0:13', 0, "document.querySelector('.title-screen .sel')?.dataset.act === 'settings'", "document.querySelector('.settings .sel')?.dataset.act ?? 'none'"));
  t.check('a direction still held as SETTINGS opens doesn’t scroll the settings', opening.frames >= 4 && opening.seen.every((v) => v === opening.seen[0]), { first: opening.seen[0], moved: [...new Set(opening.seen)], frames: opening.frames, ms: opening.ms });
  await frames(page, 3);
  // settings: held → on the music steps it up and up; on screen shake it flips once
  await waitFor(() => page.evaluate(() => !!document.querySelector('.panel.settings')), 3000, 'settings');
  await settle(page, 450);
  const goTo = async (act) => {
    for (let i = 0; i < 24 && (await selAct(page, '.settings')) !== act; i++) await padPress(page, 0, DOWN);
    return (await selAct(page, '.settings')) === act;
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('mossbound.settings.v1') ?? '{}'));
  const onMusic = await goTo('music');
  // (down to nothing first, so there is room to climb)
  for (let i = 0; i < 10; i++) await padPress(page, 0, LEFT, 1);
  const m0 = (await stored()).music;
  const music = movesOf(await page.evaluate(() => window.__hold('pad:0:15', 1000, "document.querySelector('.row[data-act=\"music\"] b').textContent")));
  const m1 = (await stored()).music;
  t.check('a held ▶ on the music turns it up step after step', onMusic && m0 === 0 && music.n >= 5 && m1 >= 0.5, { m0, m1, music });
  const onShake = await goTo('shake');
  const s0 = (await stored()).shake;
  const shake = movesOf(await page.evaluate(() => window.__hold('pad:0:15', 1000, "document.querySelector('.row[data-act=\"shake\"] b').textContent")));
  const s1 = (await stored()).shake;
  t.check('a held ▶ on a switch (screen shake) flips it once, not eight times a second', onShake && shake.n === 1 && s1 === !s0, { s0, s1, shake });
  await padPress(page, 0, B);
  // in a level: ↓ held (down a vine) as ☰ opens the pause menu doesn't scroll it; pressed there, it does
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.playLevel(0); });
  await waitFor(async () => (await screenName(page)) === 'Session', 6000, 'level');
  await settle(page, 500);
  const PAUSE = "document.querySelector('.overlay .sel')?.dataset.act ?? 'none'";
  // (☰ a little into the hold: 300 ms and two frames — by then a repeat would be on its way)
  const into = await page.evaluate((s) => window.__holdInto('pad:0:13', 9, 'n >= 2 && t >= 300', s), PAUSE);
  const stayed = into.frames >= 4 && into.seen.every((v) => v === 'resume');
  await frames(page, 3);
  const inMenu = movesOf(await page.evaluate((s) => window.__hold('pad:0:13', 1000, s), PAUSE));
  t.check('a direction already held as the pause menu opens doesn’t scroll it; pressed there, it repeats', stayed && repeats(inMenu), { stayed, into, inMenu });
  await done(page);
}

// ---- 11. (the level select's grid of cards went with the map: the arrows walk the pair from stop to
// stop, and test 9 above checks the card follows them — map.mjs covers the walking)

// ---- 12. the waits: the clear card is up a second after the clear and takes Ⓐ half a second later;
// Ⓑ / ESC in the one-screen lobby still gets a player up during the countdown; "together!" holds 0.8 s
{
  const page = await open(browser, { pads: 2 });
  await realtime(page);
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await page.evaluate(() => { const f = window.__fb.flow; f.mode = 'local'; f.seats = ['keys', 'keysR']; f.playLevel(0); });
  await waitFor(async () => (await screenName(page)) === 'Session', 8000, 'level');
  await settle(page, 600);
  const clear = await page.evaluate(() => new Promise((done) => {
    const s = window.__fbSession;
    const app = window.__fb.app;
    const n = s.L.nest;
    s.devTeleport(n.x - 12, n.y - 4, 0);
    s.devTeleport(n.x + 12, n.y - 4, 1);
    const at = { clear: 0, card: 0, next: 0 };
    let frame = 0;
    let last = performance.now();
    let k = 0;
    const tap = (on) => { window.__pads[0].buttons[0] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
    const f = () => {
      const now = performance.now();
      frame = Math.max(frame, now - last);
      last = now;
      if (!at.clear && s.state === 'clear') at.clear = now;
      if (at.clear && !at.card && document.querySelector('.overlay.clear .ov-stats')) at.card = now;
      // from the card on, Ⓐ tapped every other frame: the first one it takes is NEXT LEVEL
      if (at.card && !at.next) {
        if (app.current !== s || app.pending) {
          at.next = now;
          tap(false);
        } else tap(++k % 2 === 1);
      }
      if (at.next || now - (at.clear || now) > 20000) return done({ card: Math.round(at.card - at.clear), next: Math.round(at.next - at.card), frame: Math.round(frame) });
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }));
  t.check('the clear card is up a second after the clear (it was 1.6 s)', clear.card >= 1000 - clear.frame && clear.card <= 1000 + 2 * clear.frame + 30, clear);
  // (and three frames at the least, however long: a menu nobody asked for counts both — see menu.ts)
  t.check('…and NEXT LEVEL takes Ⓐ half a second after that (it was 0.9 s)', clear.next >= 500 - clear.frame && clear.next <= Math.max(500, 3 * clear.frame) + 2 * clear.frame + 30, clear);
  await page.evaluate(() => window.__fb.flow.title());
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 4000, 'title');
  // the lobby: both seated, and in the countdown's first frames player 2 thinks better of it
  const lobby = async (sit, getUp) => {
    await page.evaluate(() => window.__fb.flow.local());
    await waitFor(async () => (await screenName(page)) === 'LocalScreen', 4000, 'lobby');
    await settle(page, 450);
    return page.evaluate((sit, getUp) => new Promise((done) => {
      const scr = window.__fb.app.current;
      // one change a frame: a seat, the other, then the getting up — and then watch for 700 ms
      const plan = [[sit[0], true], [sit[0], false], [sit[1], true], [sit[1], false], [getUp, true], [getUp, false]];
      const set = ([what, on]) => {
        const [kind, a, b] = what.split(':');
        if (kind === 'pad') window.__pads[+a].buttons[+b] = { pressed: on, touched: on, value: on ? 1 : 0 };
        else window.dispatchEvent(new KeyboardEvent(on ? 'keydown' : 'keyup', { code: a, key: a, bubbles: true }));
      };
      let i = 0;
      let counting = false;
      let end = 0;
      const f = () => {
        if (i < plan.length) {
          if (plan[i][0] === getUp && plan[i][1]) counting = !!(scr.startAt || scr.startTimer);
          set(plan[i++]);
        } else if (!end) end = performance.now() + 700;
        if (end && performance.now() >= end) return done({ counting, screen: window.__fb.app.current?.constructor.name, seats: [...scr.seats] });
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    }), sit, getUp);
  };
  const padUp = await lobby(['pad:0:0', 'pad:1:0'], 'pad:1:1');
  t.check('Ⓑ during the lobby countdown gets that player up, and the game waits', padUp.counting && padUp.screen === 'LocalScreen' && padUp.seats[0] === 'pad0' && padUp.seats[1] === null, padUp);
  await page.evaluate(() => window.__fb.flow.title());
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 4000, 'title');
  await page.evaluate(() => { window.__pads.length = 0; });
  const keysUp = await lobby(['key:Space', 'key:Enter'], 'key:Escape');
  t.check('…and so does ESC for the player on the left of the keyboard', keysUp.counting && keysUp.screen === 'LocalScreen' && keysUp.seats[0] === null && keysUp.seats[1] === 'keysR', keysUp);
  // "together!": from the link coming up to the level select, in game time
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online');
  await settle(page, 300);
  await guestRoom(page);
  const together = await page.evaluate(() => new Promise((done) => {
    const app = window.__fb.app;
    const scr = app.current;
    const t0 = app.time;
    scr.onLinkStatus('connected', '');
    const shown = !!document.querySelector('.online-screen .panel-title')?.textContent?.includes('together');
    const f = () => {
      if (app.current?.constructor.name === 'LevelSelect') return done({ shown, held: +(app.time - t0).toFixed(3) });
      if (app.time - t0 > 3) return done({ shown, held: null });
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  }));
  t.check('"together!" holds 0.8 s of game time before the level select (it was 1.4)', together.shown && together.held >= 0.8 && together.held <= 0.8 + 0.12, together);
  await done(page);
}

// ---- 13. LEAVE ROOM asks first — by mouse, keyboard, pad and touch, on the level select, the pause menu
// and the clear card — and stops asking after 3 s, or when the highlight moves off it
{
  const asking = (page) => page.evaluate(() => {
    const el = document.querySelector('[data-confirm].asking') ?? document.querySelector('[data-act="back"], [data-act="quit"], [data-act="leave"]');
    return { text: el?.textContent ?? null, asking: !!el?.classList.contains('asking'), closed: window.__link.closed, screen: window.__fb.app.current?.constructor.name };
  });
  const gone = (page) => waitFor(async () => (await screenName(page)) === 'TitleScreen', 3000, 'title').then(() => true).catch(() => false);
  const guestLevels = async (opts = {}, role = 'guest') => {
    const page = await open(browser, opts);
    await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
    await guestRoom(page, role);
    await page.evaluate(() => window.__fb.flow.levels());
    await waitFor(async () => (await screenName(page)) === 'LevelSelect', 4000, 'levels');
    await settle(page, 600);
    return page;
  };
  // the mouse (at one spot, worked out once: the second click has to come well inside the 3 s the
  // question lasts, and finding the button again costs round trips a slow machine can't spare)
  {
    const page = await guestLevels();
    const at = await page.evaluate(() => { const r = document.querySelector('.levels-screen [data-act="back"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await page.mouse.click(at.x, at.y);
    await frames(page, 2);
    const first = await asking(page);
    await page.mouse.click(at.x, at.y);
    const left = await gone(page);
    t.check('a click on LEAVE ROOM asks; a second one leaves', first.asking && /LEAVE\?/.test(first.text) && !first.closed && first.screen === 'LevelSelect' && left && (await page.evaluate(() => window.__link.closed)), { first, left });
    await done(page);
  }
  // the keyboard: ESC is LEAVE ROOM pressed
  {
    const page = await guestLevels();
    await key(page, 'Escape');
    const first = await asking(page);
    await key(page, 'Escape');
    const left = await gone(page);
    t.check('ESC on the level select asks; a second ESC leaves', first.asking && !first.closed && left, { first, left });
    await done(page);
  }
  // a controller: Ⓑ asks, Ⓐ on it then leaves — and it stops asking after 3 s
  {
    const page = await guestLevels({ pads: 1 });
    // All in the page, frame by frame: Ⓑ for two frames, then the question read against the menu's own
    // clock — when it says the question goes. It must be 3 s after the press (which the game takes
    // between the frame that pressed and the next one); every frame read before then still asks; and the
    // first frame that starts at or after it no longer does (the menu looks at the start of each frame,
    // and this reads after it in the same frame).
    const timing = await page.evaluate(() => new Promise((done) => {
      const set = (on) => { window.__pads[0].buttons[1] = { pressed: on, touched: on, value: on ? 1 : 0 }; };
      const list = window.__fb.app.current.list;
      let k = 0;
      let t0 = 0;
      let until = 0;
      let lasts = false;
      let before = 0;
      let early = 0;
      const f = (ts) => {
        if (k === 0) {
          set(true);
          t0 = performance.now();
        } else if (k === 2) set(false);
        k++;
        const el = document.querySelector('.levels-screen [data-act="back"]');
        if (!el || window.__link.closed) return done({ left: true });
        if (!until && list.asking) {
          until = list.asking.until;
          lasts = until - t0 >= 3000 && until - performance.now() <= 3000;
        }
        if (!until) return k > 6 ? done({ asked: false }) : requestAnimationFrame(f);
        const asking = el.classList.contains('asking');
        if (performance.now() < until) {
          before++;
          if (!asking) early++;
        }
        if (ts >= until) return done({ asked: true, lasts, before, droppedEarly: early, after: asking, text: el.textContent });
        requestAnimationFrame(f);
      };
      requestAnimationFrame(f);
    }));
    await padPress(page, 0, A);
    const again = await asking(page);
    await padPress(page, 0, A);
    const left = await gone(page);
    t.check('Ⓑ asks, and the question goes after 3 s (LEAVE ROOM again)', timing.asked && timing.lasts && timing.before >= 1 && timing.droppedEarly === 0 && timing.after === false && timing.text === 'LEAVE ROOM', timing);
    t.check('…then Ⓐ on it asks again, and a second Ⓐ leaves', again.asking && !again.closed && left, { again, left });
    await done(page);
  }
  // touch
  {
    const page = await guestLevels({ viewport: { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true } });
    const at = await page.evaluate(() => { const el = document.querySelector('.levels-screen [data-act="back"]'); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await settle(page, 100);
    await page.touchscreen.tap(at.x, at.y);
    await frames(page, 2);
    const first = await asking(page);
    await page.touchscreen.tap(at.x, at.y);
    const left = await gone(page);
    t.check('a tap on LEAVE ROOM asks; a second tap leaves', first.asking && !first.closed && left, { first, left });
    await done(page);
  }
  // the host's level select: the question goes when the highlight moves off it
  {
    const page = await guestLevels({}, 'host');
    await key(page, 'Escape');
    const first = await asking(page);
    await key(page, 'ArrowUp');
    const moved = await page.evaluate(() => { const el = document.querySelector('.levels-screen [data-act="back"]'); return { asking: !!el?.classList.contains('asking'), text: el?.textContent ?? null }; });
    t.check('the host’s LEAVE ROOM asks too, and stops asking when the highlight moves off it', first.asking && !moved.asking && moved.text === 'LEAVE ROOM' && !(await page.evaluate(() => window.__link.closed)), { first, moved });
    await done(page);
  }
  // in a level, as the guest: the pause menu's LEAVE ROOM, and the clear card's
  {
    const page = await open(browser, { pads: 1 });
    await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
    await guestRoom(page);
    const start = () => page.evaluate(async () => {
      const { Session } = await import('/src/game/session.ts');
      const { app, flow } = window.__fb;
      app.setScreen(new Session(app, flow, { level: 0, mode: 'online', link: window.__link, me: 1, nonce: 8, profiles: flow.profiles() }));
    });
    await start();
    await waitFor(async () => (await screenName(page)) === 'Session', 6000, 'guest level');
    await settle(page, 400);
    await page.evaluate(() => window.__fbSession.togglePause());
    await settle(page, 400);
    await padPress(page, 0, UP); // (round to the last button: LEAVE ROOM)
    const on = await selAct(page, '.overlay');
    await padPress(page, 0, A);
    const first = await asking(page);
    await padPress(page, 0, A);
    const left = await gone(page);
    t.check('the guest’s pause menu: LEAVE ROOM asks, then leaves', on === 'quit' && first.asking && !first.closed && first.screen === 'Session' && left, { on, first, left });
    await guestRoom(page);
    await start();
    await waitFor(async () => (await screenName(page)) === 'Session', 6000, 'guest level again');
    await settle(page, 400);
    await page.evaluate(() => window.__fbSession.onCtrl({ t: 'clear', n: 8, time: 12 }));
    await waitFor(() => page.evaluate(() => !!document.querySelector('.overlay.clear [data-act="leave"]')), 4000, 'clear card');
    await settle(page, 400);
    await padPress(page, 0, DOWN);
    await padPress(page, 0, A);
    const card = await asking(page);
    await padPress(page, 0, A);
    const cardLeft = await gone(page);
    t.check('the guest’s clear card: LEAVE ROOM asks, then leaves', card.asking && !card.closed && card.screen === 'Session' && cardLeft, { card, cardLeft });
    await done(page);
  }
}

// ---- 14. Xbox: the Ⓐ that hands the controllers over (hold ☰ → "Use game controls") is still down when
// the page first sees the pad — it mustn't also press the highlighted PLAY ONLINE. The next Ⓐ does.
{
  const page = await open(browser, { ua: XBOX_UA, pads: 1, hidePads: true });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await settle(page, 500);
  await page.evaluate(() => { window.__pads[0].buttons[0] = { pressed: true, touched: true, value: 1 }; window.__padsHidden = false; });
  await frames(page, 6);
  const held = { screen: await screenName(page), seen: await page.evaluate(() => window.__fb.app.input.padConnected) };
  await page.evaluate(() => { window.__pads[0].buttons[0] = { pressed: false, touched: false, value: 0 }; });
  await frames(page, 3);
  const stayed = await screenName(page);
  await padPress(page, 0, A);
  const next = await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 3000, 'online').then(() => true).catch(() => false);
  t.check('the Ⓐ that shows the controller to the page presses nothing; the next Ⓐ does', held.seen && held.screen === 'TitleScreen' && stayed === 'TitleScreen' && next, { held, stayed, next });
  await done(page);
}

// ---- 15. a controller reaches all of settings: your name (Ⓐ goes into the box, Ⓐ comes back out), the
// shared save (Ⓐ unfolds it; COPY SAVE CODE; the box to paste one into) and connection help
{
  const page = await open(browser, { ua: XBOX_UA, pads: 1 });
  await waitFor(async () => (await screenName(page)) === 'TitleScreen', 8000, 'title');
  await settle(page, 450);
  for (let i = 0; i < 4; i++) await padPress(page, 0, DOWN);
  await padPress(page, 0, A);
  await waitFor(() => page.evaluate(() => !!document.querySelector('.panel.settings')), 3000, 'settings');
  await settle(page, 450);
  const where = () => page.evaluate(() => {
    const el = document.querySelector('.settings .sel');
    return { sel: el?.dataset.act === 'fold' ? `fold:${el.textContent}` : el?.dataset.act ?? null, box: document.activeElement?.tagName === 'INPUT' ? document.activeElement.className : null, open: [...document.querySelectorAll('.settings details')].map((d) => d.open) };
  });
  await padPress(page, 0, UP);
  const name = await where();
  await padPress(page, 0, A);
  const typing = await where();
  await padPress(page, 0, A);
  await frames(page, 3);
  const out = await where();
  t.check('↑ from your colour is your name; Ⓐ goes into the box, Ⓐ again comes back out (and stays out)', name.sel === 'name' && typing.box === 'name-input' && out.box === null && out.sel === 'name', { name, typing, out });
  const walkTo = async (want) => {
    for (let i = 0; i < 20; i++) {
      if ((await where()).sel === want) return true;
      await padPress(page, 0, DOWN);
    }
    return false;
  };
  const saveHead = await walkTo('fold:your shared save');
  await padPress(page, 0, A);
  const unfolded = await where();
  await padPress(page, 0, DOWN);
  const copy = await where();
  await padPress(page, 0, A);
  const copied = await waitFor(() => page.evaluate(() => { const b = document.querySelector('.settings [data-act="copysave"]'); const code = document.querySelector('.settings .save-code'); return /COPIED|BELOW/.test(b.textContent) && (b.textContent.includes('COPIED') || !code.hidden) ? b.textContent : null; }), 2000, 'copied').catch(() => null);
  await padPress(page, 0, DOWN);
  const paste = await where();
  await padPress(page, 0, A);
  const pasting = await where();
  await padPress(page, 0, DOWN);
  const leftBox = await where();
  t.check('the shared save unfolds with Ⓐ, and COPY SAVE CODE and the paste box are reachable', saveHead && unfolded.open[0] && copy.sel === 'copysave' && !!copied && paste.sel === 'paste' && pasting.box === 'save-input' && leftBox.box === null && leftBox.sel === 'paste', { saveHead, unfolded, copy, copied, paste, pasting, leftBox });
  const helpHead = await walkTo('fold:connection help');
  await padPress(page, 0, A);
  await padPress(page, 0, DOWN);
  const turn = await where();
  await padPress(page, 0, A);
  const turnBox = await where();
  t.check('connection help unfolds too, and its boxes take the caret', helpHead && turn.open[1] && turn.sel === 'turn-url' && turnBox.box === 'turn-url', { helpHead, turn, turnBox });
  await padPress(page, 0, A);
  // and the name on PLAY ONLINE
  await page.evaluate(() => window.__fb.flow.online());
  await waitFor(async () => (await screenName(page)) === 'OnlineScreen', 4000, 'online');
  await settle(page, 450);
  await padPress(page, 0, UP);
  await padPress(page, 0, UP);
  const online = await selAct(page, '.online-screen');
  await padPress(page, 0, A);
  const onlineBox = await page.evaluate(() => document.activeElement?.className ?? null);
  t.check('PLAY ONLINE’s name box is reachable the same way', online === 'name' && onlineBox === 'name-input', { online, onlineBox });
  await done(page);
}

await browser.close();
process.exit(t.finish('navigation', errors) ? 0 : 1);
