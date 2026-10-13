import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-600.css';
import './style.css';
import { Sfx } from './audio';
import { Game, VIEW, type ArenaShape } from './game';
import { pick } from './math';
import { FONT, render, type ThemeName } from './render';
import { WEAPON_INFO, WEAPON_KINDS, type WeaponKind } from './weapons';

interface Settings {
  fighters: WeaponKind[];
  arena: ArenaShape;
  theme: ThemeName;
  gravity: number;
  ballScale: number;
  speed: number;
  sound: boolean;
  trails: boolean;
  autoRematch: boolean;
}

const MAX_FIGHTERS = 6;
const STORAGE_KEY = 'bounceballs.settings';
/** First visit follows the page's theme if the host set one, else the OS setting. */
function initialTheme(): ThemeName {
  const host = document.documentElement.dataset.theme;
  if (host === 'light' || host === 'dark') return host;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const DEFAULTS: Settings = {
  fighters: ['sword', 'dagger'],
  arena: 'square',
  theme: initialTheme(),
  gravity: 700,
  ballScale: 1,
  speed: 1,
  sound: true,
  trails: true,
  autoRematch: false,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const s = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
    s.fighters = s.fighters.filter((k) => k in WEAPON_INFO).slice(0, MAX_FIGHTERS);
    if (s.fighters.length < 2) s.fighters = [...DEFAULTS.fighters];
    return s;
  } catch {
    return { ...DEFAULTS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}

const settings = loadSettings();
const sfx = new Sfx();
sfx.enabled = settings.sound;

let game = newGame();
let paused = false;

function newGame() {
  return new Game({ fighters: [...settings.fighters], arena: settings.arena, gravity: settings.gravity, ballScale: settings.ballScale }, sfx);
}

function restart() {
  game = newGame();
  paused = false;
  syncPause();
}

// ---------- canvas ----------

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
let scale = 1;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  scale = canvas.width / VIEW.w;
}
window.addEventListener('resize', resize);
resize();

function toWorld(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * VIEW.w,
    y: ((e.clientY - rect.top) / rect.height) * VIEW.h,
  };
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  const p = toWorld(e);
  if (game.winner !== undefined && game.overTime > 0.6) {
    restart();
    return;
  }
  const ball = game.alive.find((b) => Math.hypot(b.x - p.x, b.y - p.y) < b.r + 14);
  if (ball) {
    game.grab = { ball, x: p.x, y: p.y };
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!game.grab) return;
  const p = toWorld(e);
  game.grab.x = p.x;
  game.grab.y = p.y;
});

const release = () => {
  game.grab = null;
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

window.addEventListener('keydown', (e) => {
  sfx.unlock();
  if (e.target instanceof HTMLSelectElement) return;
  if (e.code === 'Space') {
    e.preventDefault();
    paused = !paused;
    syncPause();
  } else if (e.code === 'KeyR') {
    restart();
  }
});

// ---------- panel ----------

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fightersEl = $('fighters');
const pauseBtn = $<HTMLButtonElement>('pause');

function syncPause() {
  pauseBtn.innerHTML = `${paused ? 'Resume' : 'Pause'} <kbd>Space</kbd>`;
}

function renderFighters() {
  fightersEl.innerHTML = '';
  settings.fighters.forEach((kind, i) => {
    const row = document.createElement('div');
    row.className = 'fighter';

    const swatch = document.createElement('span');
    swatch.className = 'swatch';
    swatch.style.background = WEAPON_INFO[kind].color;

    const select = document.createElement('select');
    for (const k of WEAPON_KINDS) {
      const opt = document.createElement('option');
      opt.value = k;
      opt.textContent = WEAPON_INFO[k].label;
      opt.selected = k === kind;
      select.append(opt);
    }
    select.addEventListener('change', () => {
      settings.fighters[i] = select.value as WeaponKind;
      applyFighters();
    });

    const remove = document.createElement('button');
    remove.className = 'remove';
    remove.textContent = '×';
    remove.title = 'Remove fighter';
    remove.disabled = settings.fighters.length <= 2;
    remove.addEventListener('click', () => {
      settings.fighters.splice(i, 1);
      applyFighters();
    });

    const blurb = document.createElement('small');
    blurb.textContent = WEAPON_INFO[kind].blurb;

    row.append(swatch, select, remove, blurb);
    fightersEl.append(row);
  });
  $<HTMLButtonElement>('add').disabled = settings.fighters.length >= MAX_FIGHTERS;
}

function applyFighters() {
  saveSettings();
  renderFighters();
  restart();
}

$('add').addEventListener('click', () => {
  if (settings.fighters.length >= MAX_FIGHTERS) return;
  settings.fighters.push(pick(WEAPON_KINDS));
  applyFighters();
});

$('random').addEventListener('click', () => {
  const n = 2 + Math.floor(Math.random() * 3);
  const pool = [...WEAPON_KINDS].sort(() => Math.random() - 0.5);
  settings.fighters = pool.slice(0, n);
  applyFighters();
});

function bindSegmented<K extends 'arena' | 'theme'>(id: K, onChange: () => void) {
  const buttons = [...$(id).querySelectorAll<HTMLButtonElement>('button')];
  const sync = () => {
    for (const b of buttons) b.classList.toggle('on', b.dataset.v === settings[id]);
  };
  for (const b of buttons) {
    b.addEventListener('click', () => {
      settings[id] = b.dataset.v as Settings[K];
      sync();
      saveSettings();
      onChange();
    });
  }
  sync();
}
bindSegmented('arena', restart);
bindSegmented('theme', syncTheme);

function syncTheme() {
  document.documentElement.dataset.theme = settings.theme;
}
syncTheme();

function bindRange(id: 'gravity' | 'speed' | 'ballScale', format: (v: number) => string, onChange: (v: number) => void) {
  const input = $<HTMLInputElement>(id);
  const out = $<HTMLOutputElement>(`${id}Out`);
  input.value = String(settings[id]);
  out.textContent = format(settings[id]);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    settings[id] = v;
    out.textContent = format(v);
    onChange(v);
    saveSettings();
  });
}
bindRange('gravity', (v) => String(v), (v) => (game.cfg.gravity = v));
bindRange('speed', (v) => `${v}x`, () => {});
// Ball size changes spawn spacing, so it starts a fresh round.
bindRange('ballScale', (v) => `${v.toFixed(1)}x`, restart);

function bindCheck(id: 'sound' | 'trails' | 'autoRematch', onChange: (v: boolean) => void = () => {}) {
  const input = $<HTMLInputElement>(id);
  input.checked = settings[id];
  input.addEventListener('change', () => {
    settings[id] = input.checked;
    onChange(input.checked);
    saveSettings();
  });
}
bindCheck('sound', (v) => {
  sfx.enabled = v;
  if (v) sfx.unlock();
});
bindCheck('trails');
bindCheck('autoRematch');

$('fight').addEventListener('click', () => {
  sfx.unlock();
  restart();
});
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  syncPause();
});

renderFighters();
syncPause();

// Canvas text only uses a web font once it's loaded, so request the weights up front.
for (const w of [600, 700, 800]) void document.fonts.load(`${w} 32px ${FONT}`);

// ---------- loop ----------

let last = performance.now();
function frame(now: number) {
  const realDt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  if (!paused) game.advance(realDt, settings.speed);
  if (settings.autoRematch && game.winner !== undefined && game.overTime > 4.5) restart();

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  render(ctx, game, { theme: settings.theme, trails: settings.trails, paused, autoRematch: settings.autoRematch });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
