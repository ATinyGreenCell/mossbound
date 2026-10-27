import { esc } from './menu';

export interface PartnerStatus {
  name: string;
  color: string;
  ping: number;
  via: 'direct' | 'relay' | null;
  state: 'ok' | 'waiting' | 'away';
}

/**
 * The in-level HUD (DOM over the canvas): seeds and golden feathers on the left, the partner's
 * connection on the right, the level banner, sign hints and toasts. Only touched when something
 * changes, never every frame.
 */
export class Hud {
  readonly el: HTMLDivElement;
  private seedsEl: HTMLElement;
  private feathersEl: HTMLElement;
  private partnerEl: HTMLElement;
  private bannerEl: HTMLElement;
  private hintEl: HTMLElement;
  private toastEl: HTMLElement;
  private noticeEl: HTMLElement;
  private last = { seeds: '', feathers: -1, partner: '', hint: '', notice: '' };
  private toastTimer = 0;
  onMenu: (() => void) | null = null;

  constructor(parent: HTMLElement, title: string, subtitle: string) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-left">
        <div class="hud-seeds"><i class="seed-ico"></i><span></span></div>
        <div class="hud-feathers"></div>
      </div>
      <div class="hud-right">
        <div class="hud-partner hidden"></div>
        <div class="hud-menu" data-menu role="button" aria-label="Menu"><i></i><i></i><i></i></div>
      </div>
      <div class="hud-banner"><b>${esc(title)}</b><span>${esc(subtitle)}</span></div>
      <div class="hud-hint hidden"></div>
      <div class="hud-notice hidden"></div>
      <div class="hud-toast hidden"></div>`;
    parent.appendChild(this.el);
    this.seedsEl = this.el.querySelector('.hud-seeds span')!;
    this.feathersEl = this.el.querySelector('.hud-feathers')!;
    this.partnerEl = this.el.querySelector('.hud-partner')!;
    this.bannerEl = this.el.querySelector('.hud-banner')!;
    this.hintEl = this.el.querySelector('.hud-hint')!;
    this.toastEl = this.el.querySelector('.hud-toast')!;
    this.noticeEl = this.el.querySelector('.hud-notice')!;
    this.el.querySelector('[data-menu]')!.addEventListener('click', () => this.onMenu?.());
    setTimeout(() => this.bannerEl.classList.add('gone'), 3200);
  }

  setSeeds(n: number, total: number) {
    const s = `${n} / ${total}`;
    if (s === this.last.seeds) return;
    this.last.seeds = s;
    this.seedsEl.textContent = s;
    this.seedsEl.parentElement!.classList.remove('pop');
    void this.seedsEl.parentElement!.offsetWidth;
    this.seedsEl.parentElement!.classList.add('pop');
  }

  setFeathers(mask: number) {
    if (mask === this.last.feathers) return;
    this.last.feathers = mask;
    this.feathersEl.innerHTML = [0, 1, 2].map((i) => `<i class="feather-ico${mask & (1 << i) ? ' on' : ''}"></i>`).join('');
  }

  setPartner(p: PartnerStatus | null) {
    const key = p ? `${p.name}|${p.color}|${Math.round(p.ping / 10)}|${p.via}|${p.state}` : '';
    if (key === this.last.partner) return;
    this.last.partner = key;
    this.partnerEl.classList.toggle('hidden', !p);
    if (!p) return;
    const bars = p.state !== 'ok' ? 0 : p.ping < 90 ? 3 : p.ping < 180 ? 2 : 1;
    const label = p.state === 'away' ? 'reconnecting…' : p.state === 'waiting' ? 'joining…' : `${Math.round(p.ping)} ms${p.via === 'relay' ? ' · relay' : ''}`;
    this.partnerEl.innerHTML = `<i class="dot" style="background:${p.color}"></i><b>${esc(p.name)}</b><span class="bars b${bars}"><i></i><i></i><i></i></span><span class="lat">${label}</span>`;
  }

  /** A sign's hint, positioned (CSS px) above the sign. */
  hint(text: string | null, x = 0, y = 0) {
    if (!text) {
      if (this.last.hint) {
        this.last.hint = '';
        this.hintEl.classList.add('hidden');
      }
      return;
    }
    if (text !== this.last.hint) {
      this.last.hint = text;
      this.hintEl.innerHTML = text;
      this.hintEl.classList.remove('hidden');
    }
    this.hintEl.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
  }

  /** A lasting notice in the middle of the screen (partner away, controller lost), or null. */
  notice(html: string | null) {
    const v = html ?? '';
    if (v === this.last.notice) return;
    this.last.notice = v;
    this.noticeEl.classList.toggle('hidden', !html);
    this.noticeEl.innerHTML = v;
  }

  toast(text: string) {
    this.toastEl.textContent = text;
    this.toastEl.classList.remove('hidden');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.add('hidden'), 2600);
  }

  dispose() {
    window.clearTimeout(this.toastTimer);
    this.el.remove();
  }
}
