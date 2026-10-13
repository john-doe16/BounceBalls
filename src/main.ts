import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/archivo/latin-400.css';
import '@fontsource/archivo/latin-500.css';
import '@fontsource/archivo/latin-600.css';
import './style.css';
import { Sfx } from './audio';
import { ARENA, Game, VIEW, type ArenaShape } from './game';
import { pick } from './math';
import { parseMidi } from './music/midi';
import { MusicGame, type MusicFormat } from './music/musicGame';
import { renderMusic } from './music/musicRender';
import { SONGS, type Song } from './music/songs';
import { FONT, render, type ThemeName } from './render';
import { WEAPON_INFO, WEAPON_KINDS, type WeaponKind } from './weapons';

type Mode = 'battle' | 'music';

interface Settings {
  mode: Mode;
  fighters: WeaponKind[];
  arena: ArenaShape;
  theme: ThemeName;
  gravity: number;
  ballScale: number;
  zoom: number;
  speed: number;
  sound: boolean;
  volume: number;
  trails: boolean;
  outline: boolean;
  autoRematch: boolean;
  songId: string;
  format: MusicFormat;
  shrink: boolean;
  colorCycle: boolean;
  showNotes: boolean;
  ballNumber: boolean;
  splitParts: boolean;
  autoRestart: boolean;
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
  mode: 'battle',
  fighters: ['sword', 'dagger'],
  arena: 'square',
  theme: initialTheme(),
  gravity: 700,
  ballScale: 1,
  zoom: 1,
  speed: 1,
  sound: true,
  volume: 1,
  trails: true,
  outline: true,
  autoRematch: false,
  songId: SONGS[0].id,
  format: 'ring',
  shrink: false,
  colorCycle: true,
  showNotes: true,
  ballNumber: true,
  splitParts: true,
  autoRestart: false,
};

const FORMAT_INFO: Record<MusicFormat, string> = {
  ring: 'One ball in one ring. Every bounce plays the next note.',
  escape: 'Break out through the gaps in 20 spinning rings. Each ring shatters on the way out.',
  grow: 'The ball grows on every bounce until it fills the ring.',
  sync: "The ball falls through slanted platforms, landing on each one exactly on the song's real rhythm. Works best with MIDI files.",
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    const s = { ...DEFAULTS, ...JSON.parse(raw) } as Settings;
    s.fighters = s.fighters.filter((k) => k in WEAPON_INFO).slice(0, MAX_FIGHTERS);
    if (s.fighters.length < 2) s.fighters = [...DEFAULTS.fighters];
    // Uploaded songs only live for the session.
    if (!SONGS.some((song) => song.id === s.songId)) s.songId = DEFAULTS.songId;
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
sfx.volume = settings.volume;
/** MIDI files loaded this session. */
const uploaded: Song[] = [];

const allSongs = () => [...SONGS, ...uploaded];
const currentSong = () => allSongs().find((s) => s.id === settings.songId) ?? SONGS[0];

let game = newGame();
let music = newMusic();
let paused = false;

function newGame() {
  return new Game({ fighters: [...settings.fighters], arena: settings.arena, gravity: settings.gravity, ballScale: settings.ballScale }, sfx);
}

function newMusic() {
  return new MusicGame(
    { format: settings.format, song: currentSong(), gravity: settings.gravity, shrink: settings.shrink, colorCycle: settings.colorCycle, showNotes: settings.showNotes, ballScale: settings.ballScale, split: settings.splitParts },
    sfx,
  );
}

function restart() {
  if (settings.mode === 'battle') game = newGame();
  else music = newMusic();
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

/** Pointer position in arena coordinates, undoing the zoom. */
function toWorld(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  const sx = ((e.clientX - rect.left) / rect.width) * VIEW.w;
  const sy = ((e.clientY - rect.top) / rect.height) * VIEW.h;
  return { x: ARENA.cx + (sx - ARENA.cx) / settings.zoom, y: ARENA.cy + (sy - ARENA.cy) / settings.zoom };
}

canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  if (settings.mode === 'music') {
    if (music.finished && music.finishedFor > 0.6) restart();
    return;
  }
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

function syncMode() {
  for (const el of document.querySelectorAll<HTMLElement>('[data-mode]')) el.hidden = el.dataset.mode !== settings.mode;
  $('fight').innerHTML = `${settings.mode === 'battle' ? 'Rematch' : 'Restart'} <kbd>R</kbd>`;
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

// songs

const songSelect = $<HTMLSelectElement>('song');
const songInfo = $('songInfo');

function renderSongs() {
  songSelect.innerHTML = '';
  for (const s of allSongs()) {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.id.startsWith('upload:') ? `${s.name} (your file)` : s.name;
    opt.selected = s.id === settings.songId;
    songSelect.append(opt);
  }
}

function showSongInfo(text: string, error = false) {
  songInfo.textContent = text;
  songInfo.classList.toggle('error', error);
}

songSelect.addEventListener('change', () => {
  settings.songId = songSelect.value;
  saveSettings();
  showSongInfo(`${currentSong().events.length} notes`);
  restart();
});

const midiInput = $<HTMLInputElement>('midiFile');
$('upload').addEventListener('click', () => midiInput.click());
midiInput.addEventListener('change', async () => {
  const file = midiInput.files?.[0];
  midiInput.value = '';
  if (!file) return;
  try {
    const song = parseMidi(await file.arrayBuffer(), file.name);
    const existing = uploaded.findIndex((s) => s.id === song.id);
    if (existing >= 0) uploaded.splice(existing, 1, song);
    else uploaded.push(song);
    settings.songId = song.id;
    renderSongs();
    const parts = song.parts?.length ?? 1;
    showSongInfo(`Loaded "${song.name}": ${song.events.length} notes, ${parts} instrument${parts === 1 ? '' : 's'}. Files you load last until you close the page.`);
    restart();
  } catch (err) {
    showSongInfo(err instanceof Error ? err.message : "Couldn't read that file.", true);
  }
});

// segmented controls

function bindSegmented<K extends 'arena' | 'theme' | 'mode' | 'format'>(id: K, onChange: () => void) {
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
bindSegmented('mode', () => {
  syncMode();
  restart();
});
bindSegmented('format', () => {
  syncFormat();
  restart();
});

function syncTheme() {
  document.documentElement.dataset.theme = settings.theme;
}
syncTheme();

function syncFormat() {
  $('formatInfo').textContent = FORMAT_INFO[settings.format];
  $('shrinkRow').hidden = settings.format !== 'ring';
  $('splitRow').hidden = settings.format !== 'sync';
}

function bindRange(id: 'gravity' | 'speed' | 'ballScale' | 'volume' | 'zoom', format: (v: number) => string, onChange: (v: number) => void) {
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
bindRange('gravity', (v) => String(v), (v) => {
  game.cfg.gravity = v;
  music.cfg.gravity = v;
});
bindRange('speed', (v) => `${v}x`, () => {});
bindRange('zoom', (v) => `${v.toFixed(2)}x`, () => {});
bindRange('volume', (v) => `${Math.round(v * 100)}%`, (v) => {
  sfx.volume = v;
  // Dragging the slider counts as a click, so it can also switch sound on.
  sfx.unlock();
});
// Ball size changes spawn spacing, so it starts a fresh round.
bindRange('ballScale', (v) => `${v.toFixed(1)}x`, restart);

type CheckId = 'sound' | 'trails' | 'outline' | 'autoRematch' | 'autoRestart' | 'shrink' | 'colorCycle' | 'showNotes' | 'ballNumber' | 'splitParts';
function bindCheck(id: CheckId, onChange: (v: boolean) => void = () => {}) {
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
bindCheck('outline');
bindCheck('autoRematch');
bindCheck('autoRestart');
bindCheck('shrink', restart);
bindCheck('colorCycle', (v) => (music.cfg.colorCycle = v));
bindCheck('showNotes', (v) => (music.cfg.showNotes = v));
bindCheck('ballNumber');
bindCheck('splitParts', restart);

$('fight').addEventListener('click', () => {
  sfx.unlock();
  restart();
});
pauseBtn.addEventListener('click', () => {
  paused = !paused;
  syncPause();
});

renderFighters();
renderSongs();
showSongInfo(`${currentSong().events.length} notes`);
syncFormat();
syncMode();
syncPause();

// Canvas text only uses a web font once it's loaded, so request the weights up front.
for (const w of [600, 700, 800]) void document.fonts.load(`${w} 32px ${FONT}`);

// ---------- loop ----------

let last = performance.now();
function frame(now: number) {
  const realDt = Math.min((now - last) / 1000, 1 / 20);
  last = now;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  if (settings.mode === 'battle') {
    if (!paused) game.advance(realDt, settings.speed);
    if (settings.autoRematch && game.winner !== undefined && game.overTime > 4.5) restart();
    render(ctx, game, { theme: settings.theme, trails: settings.trails, outline: settings.outline, zoom: settings.zoom, paused, autoRematch: settings.autoRematch });
  } else {
    if (!paused) music.advance(realDt, settings.speed);
    if (settings.autoRestart && music.readyToRestart) restart();
    renderMusic(ctx, music, { theme: settings.theme, trails: settings.trails, outline: settings.outline, zoom: settings.zoom, paused, ballNumber: settings.ballNumber });
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
