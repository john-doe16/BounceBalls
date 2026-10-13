import type { Sfx } from '../audio';
import { Fx } from '../fx';
import { ARENA } from '../game';
import { TAU, rand, type Vec } from '../math';
import { noteName, type NoteEvent, type Part, type Song, type Voice } from './songs';
import { PHRASE_TAIL, mergeEvents, planFallBest, type Hit } from './sync';

export type MusicFormat = 'ring' | 'escape' | 'grow' | 'sync';

export interface MusicConfig {
  format: MusicFormat;
  song: Song;
  gravity: number;
  /** Ring format: the ring tightens a little with every bounce. */
  shrink: boolean;
  /** The ball changes color on every bounce. */
  colorCycle: boolean;
  /** Pop up the note's name where the ball bounces. */
  showNotes: boolean;
  /** Multiplies the ball's starting size. */
  ballScale: number;
  /** Beat Sync: give each instrument its own ball and lane. */
  split: boolean;
}

/** One Beat Sync ball: a part of the song falling down its own lane. */
export interface Lane {
  name: string;
  voice: Voice;
  color: string;
  hits: Hit[];
  hitIndex: number;
  ball: { x: number; y: number; vx: number; vy: number; r: number };
  trail: Vec[];
  bounces: number;
  /** 0 while waiting to drop in or after fading out between phrases. */
  alpha: number;
  /** Each lane is its own column with its own camera height, so every ball stays centered. */
  camY: number;
  /** Stereo position (-1 left .. 1 right), matching the lane's column. */
  pan: number;
  gain: number;
  /** Column the lane is drawn in. */
  x0: number;
  x1: number;
  fx: Fx;
}

export interface Ring {
  r: number;
  angle: number;
  /** Radians per second. */
  speed: number;
  /** Half-width of the gap in radians; 0 for a solid ring. */
  gapHalf: number;
  /** Band thickness. Escape rings are as thick as their spacing, so neighbors touch. */
  thick: number;
  color: string;
  broken: boolean;
  flash: number;
}

const DT = 1 / 240;
/** Flat palette the ball and escape rings cycle through. */
export const MUSIC_COLORS = ['#E63946', '#F26B1D', '#F4B400', '#2BA84A', '#14A3A3', '#2F6FDE', '#7B4FD6', '#C2255C'];
const OUTER = ARENA.half;
const ESCAPE_RINGS = 20;
const ESCAPE_INNER = 70;
const ESCAPE_OUTER = 300;
const FINISH_HOLD = 3.5;
const LANE_GRAVITY = 1.5;
/** Lane colors by part name. */
const LANE_COLORS: Record<string, string> = { MELODY: '#E63946', BASS: '#2F6FDE', HARMONY: '#2BA84A', 'HARMONY 2': '#7B4FD6', DRUMS: '#F4B400' };
/** Part levels, so the melody doesn't drown out everything else. */
const PART_GAIN: Record<string, number> = { MELODY: 0.75, HARMONY: 1.1, 'HARMONY 2': 1.1, BASS: 1.25, DRUMS: 0.9 };
/** A part resting longer than this fades out and drops back in instead of plummeting through the silence. */
const REST_MAX = 1.6;
/** Escape gaps: at least this many radians wide, or this many px of arc on small rings. */
const GAP_MIN = 0.6;
const GAP_ARC = 70;

export class MusicGame {
  ball: { x: number; y: number; vx: number; vy: number; r: number } = { x: ARENA.cx, y: ARENA.cy, vx: 0, vy: 0, r: 16 };
  rings: Ring[] = [];
  fx = new Fx();
  color = 0;
  noteIndex = 0;
  bounces = 0;
  time = 0;
  trail: Vec[] = [];
  /** Set when the run ends: the last ring has shattered and the ball is flying away. */
  finished: { at: number } | null = null;
  /** The notes this run plays through (merged into hits for Beat Sync). */
  events: NoteEvent[];
  private acc = 0;
  private hitstop = 0;
  private lastNote = -1;
  /** Beat Sync: one lane per part (just one when not splitting), and the camera position. */
  lanes: Lane[] = [];
  camX: number = ARENA.cx;
  camY = 0;
  private syncGravity = 0;

  constructor(
    public cfg: MusicConfig,
    public sfx: Sfx,
  ) {
    this.events = cfg.song.events;
    const a = rand(0, TAU);
    const s = rand(380, 520);
    this.ball.vx = Math.cos(a) * s;
    this.ball.vy = Math.sin(a) * s;

    if (cfg.format === 'escape') {
      this.ball.r = 9 * cfg.ballScale;
      const spacing = (ESCAPE_OUTER - ESCAPE_INNER) / (ESCAPE_RINGS - 1);
      for (let i = 0; i < ESCAPE_RINGS; i++) {
        const r = ESCAPE_INNER + i * spacing;
        this.rings.push({
          r,
          thick: spacing,
          angle: rand(0, TAU),
          speed: (0.7 + i * 0.04) * (i % 2 ? -1 : 1),
          gapHalf: Math.max(GAP_MIN, GAP_ARC / r),
          color: MUSIC_COLORS[i % MUSIC_COLORS.length],
          broken: false,
          flash: 0,
        });
      }
    } else {
      this.ball.r = (cfg.format === 'grow' ? 14 : 18) * cfg.ballScale;
      this.ball.x = ARENA.cx + rand(-60, 60);
      this.ball.y = ARENA.cy - 120;
      this.rings.push({ r: OUTER, thick: 0, angle: 0, speed: 0, gapHalf: 0, color: 'ink', broken: false, flash: 0 });
    }

    if (cfg.format === 'sync') this.setupSync();
  }

  /** Beat Sync: an open drop (no ring) with a platform planned for every note, one lane per part. */
  private setupSync() {
    const cfg = this.cfg;
    this.rings = [];
    const g = (this.syncGravity = Math.max(300, cfg.gravity));
    const all: Part = { name: '', voice: 'keys', events: cfg.song.events };
    const parts = (cfg.split && cfg.song.parts && cfg.song.parts.length > 1 ? cfg.song.parts : [all])
      .map((p) => ({ ...p, events: mergeEvents(p.events) }))
      .filter((p) => p.events.length);
    const n = parts.length;
    const multi = n > 1;
    // Narrow columns leave little room to deflect sideways, so balls mostly hop; stronger gravity
    // makes each hop drop further and keeps a busy part's platforms from piling up.
    if (multi) this.syncGravity = g * LANE_GRAVITY;
    const r = this.ball.r * (n >= 3 ? 0.75 : n === 2 ? 0.9 : 1);
    const left = 60;
    // Busier parts get wider columns: sparse parts barely need the room, busy ones crowd without it.
    const weights = parts.map((p) => Math.sqrt(p.events.length));
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map((wt) => Math.max(0.2, wt / total));
    const norm = widths.reduce((a, b) => a + b, 0);
    const span = VIEW_W - 2 * left;
    const edges = [left];
    for (const wd of widths) edges.push(edges[edges.length - 1] + (wd / norm) * span);

    this.lanes = parts.map((part, i) => {
      const x0 = edges[i];
      const w = edges[i + 1] - x0;
      const start = { x: multi ? x0 + w / 2 : ARENA.cx, y: 0 };
      const opts = multi ? { xMin: x0 + r + 14, xMax: x0 + w - r - 14, halfMax: Math.min(42, w * 0.28), absolute: true, restMax: REST_MAX } : {};
      return {
        name: part.name,
        voice: part.voice,
        color: LANE_COLORS[part.name] ?? MUSIC_COLORS[i % MUSIC_COLORS.length],
        hits: planFallBest(part.events, start, this.syncGravity, r, opts),
        hitIndex: 0,
        ball: { x: start.x, y: start.y, vx: 0, vy: 0, r },
        trail: [],
        bounces: 0,
        alpha: 0,
        camY: 0,
        pan: multi ? ((x0 + w / 2 - VIEW_W / 2) / (VIEW_W / 2 - left)) * 0.8 : 0,
        gain: multi ? (PART_GAIN[part.name] ?? 1) : 1,
        x0: multi ? x0 : 0,
        x1: multi ? x0 + w : VIEW_W,
        fx: multi ? new Fx() : this.fx,
      };
    });
    this.ball = this.lanes[0].ball;
    // The progress bar counts every hit in every lane.
    this.events = this.lanes.flatMap((l) => l.hits.map((h) => h.ev));
    this.camX = ARENA.cx;
    this.camY = 0;
  }

  get multiLane() {
    return this.lanes.length > 1;
  }

  get ballColor() {
    return MUSIC_COLORS[this.color % MUSIC_COLORS.length];
  }

  get ringsLeft() {
    return this.rings.filter((r) => !r.broken).length;
  }

  advance(realDt: number, speed: number) {
    let simDt = 0;
    if (this.hitstop > 0) {
      this.hitstop -= realDt;
    } else {
      simDt = realDt * speed;
      this.acc += simDt;
      let steps = 0;
      while (this.acc >= DT && steps < 60) {
        this.step(DT);
        this.acc -= DT;
        steps++;
      }
      this.trail.push({ x: this.ball.x, y: this.ball.y });
      if (this.trail.length > 14) this.trail.shift();
      for (const l of this.lanes) {
        if (l.alpha > 0) l.trail.push({ x: l.ball.x, y: l.ball.y });
        else l.trail.length = 0;
        if (l.trail.length > 14) l.trail.shift();
      }
    }
    for (const r of this.rings) r.flash = Math.max(0, r.flash - realDt * 4);
    this.fx.update(simDt, realDt);
    for (const l of this.lanes) if (l.fx !== this.fx) l.fx.update(simDt, realDt);
  }

  private step(dt: number) {
    this.time += dt;
    const b = this.ball;
    for (const r of this.rings) r.angle += r.speed * dt;
    if (this.cfg.format === 'sync') {
      this.stepSync();
      this.followCamera();
      return;
    }

    b.vy += this.cfg.gravity * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;

    const dx = b.x - ARENA.cx;
    const dy = b.y - ARENA.cy;
    const d = Math.hypot(dx, dy) || 1;
    const nx = dx / d;
    const ny = dy / d;

    // The ball is always inside the innermost ring that's left; it bounces off that ring's inner edge.
    const ring = this.rings.find((r) => !r.broken);
    // Out of the last escape ring there's no wall: the ball just flies away.
    if (!ring) return;
    const wall = ring.r - ring.thick / 2;

    // Slipping into the gap breaks the ring at once — the next ring is right behind it.
    if (ring && ring.gapHalf > 0 && d + b.r > wall && this.inGap(ring, Math.atan2(dy, dx))) {
      this.breakRing(ring);
      return;
    }

    if (d + b.r > wall) {
      b.x = ARENA.cx + nx * (wall - b.r);
      b.y = ARENA.cy + ny * (wall - b.r);
      const vn = b.vx * nx + b.vy * ny;
      if (vn > 0) {
        b.vx -= 2 * vn * nx;
        b.vy -= 2 * vn * ny;
        this.bounce(ARENA.cx + nx * wall, ARENA.cy + ny * wall, ring);
      }
    }

    // Keep it lively without gravity, and stop runaway speeds.
    const s = Math.hypot(b.vx, b.vy);
    const min = 320;
    const max = 1500;
    if (s > max) (b.vx *= max / s), (b.vy *= max / s);
    else if (this.cfg.gravity === 0 && s < min && s > 0) (b.vx *= min / s), (b.vy *= min / s);
  }

  /** True when the ball's angle (around the arena center) lines up with the ring's opening. */
  private inGap(ring: Ring, ballAngle: number) {
    let off = ballAngle - ring.angle;
    off = Math.atan2(Math.sin(off), Math.cos(off));
    return Math.abs(off) < ring.gapHalf - Math.asin(Math.min(1, this.ball.r / ring.r)) * 0.8;
  }

  /** Beat Sync: each lane follows its planned fall, playing its notes as its ball meets each platform. */
  private stepSync() {
    const g = this.syncGravity;
    let active = 0;
    for (const lane of this.lanes) {
      const b = lane.ball;
      while (lane.hitIndex < lane.hits.length && this.time >= lane.hits[lane.hitIndex].t) {
        const h = lane.hits[lane.hitIndex++];
        lane.bounces++;
        if (this.cfg.colorCycle && !this.multiLane) this.color = h.color;
        const color = this.multiLane ? lane.color : this.ballColor;
        this.hitFx(h.p.x - h.n.x * b.r, h.p.y - h.n.y * b.r, undefined, this.playEvent(h.ev, lane.voice, lane.gain, lane.pan), color, lane.fx);
      }
      if (lane.hitIndex < lane.hits.length) active++;

      // Position comes straight from the plan, so it can never drift off the beat.
      const next = lane.hits[lane.hitIndex];
      const prev = lane.hits[lane.hitIndex - 1];
      let p: Vec, v: Vec, t0: number;
      if (next?.launch && this.time >= next.launch.t) {
        // Dropping in for the next phrase.
        p = next.launch.p;
        v = { x: 0, y: 0 };
        t0 = next.launch.t;
        lane.alpha = Math.min(1, (this.time - t0) / 0.15);
      } else if (prev) {
        p = prev.p;
        v = prev.vOut;
        t0 = prev.t;
        // Between phrases (several lanes) the ball fades out, then waits where it faded
        // instead of falling forever with the view chasing it.
        const phraseOver = this.multiLane && (!next || next.launch);
        lane.alpha = phraseOver ? Math.max(0, 1 - (this.time - t0) / PHRASE_TAIL) : 1;
        if (phraseOver && this.time - t0 > PHRASE_TAIL) t0 = this.time - PHRASE_TAIL;
      } else {
        // Not started yet: wait, hidden, where it will drop in.
        p = next.launch!.p;
        v = { x: 0, y: 0 };
        t0 = this.time;
        lane.alpha = 0;
      }
      const u = this.time - t0;
      b.x = p.x + v.x * u;
      b.y = p.y + v.y * u + 0.5 * g * u * u;
      b.vx = v.x;
      b.vy = v.y + g * u;
    }
    if (!active && !this.finished) this.finished = { at: this.time };
  }

  /** Locks each camera on its ball so it stays dead center (one ball: both axes; lanes: height). */
  private followCamera() {
    this.camX = this.multiLane ? ARENA.cx : this.ball.x;
    this.camY = this.ball.y;
    // While a lane's ball is hidden between phrases, its view eases to where it will drop back in.
    for (const l of this.lanes) {
      const next = l.hits[l.hitIndex];
      const target = l.alpha > 0 || !next?.launch ? l.ball.y : next.launch.p.y;
      l.camY = l.alpha > 0.99 ? l.ball.y : l.camY + (target - l.camY) * 0.06;
    }
  }

  private bounce(x: number, y: number, ring: Ring | undefined) {
    const b = this.ball;
    this.hitFx(x, y, ring, this.playNext());

    if (this.cfg.format === 'grow' && !this.finished) {
      b.r = Math.min(b.r + 2.7, OUTER - 8);
      // Full: the ring shatters and the ball sails out.
      if (b.r >= OUTER - 8 && ring) this.breakRing(ring);
    }
    if (this.cfg.format === 'ring' && this.cfg.shrink && ring && !this.finished) {
      ring.r = Math.max(b.r * 1.6, ring.r - 2);
      if (ring.r <= b.r * 1.6) this.breakRing(ring);
    }
  }

  /** Ripple, particles, color change and note name where the ball meets the wall. */
  private hitFx(x: number, y: number, ring: Ring | undefined, note: string | null, color?: string, fx = this.fx) {
    this.bounces++;
    if (ring) ring.flash = 1;
    if (this.cfg.colorCycle && this.cfg.format !== 'sync') this.color++;
    const c = color ?? this.ballColor;
    fx.ring(x, y, c, 40, 4, 0.35);
    fx.burst(x, y, c, 8, 220, { size: 4, life: 0.4, grav: 0 });
    if (note && this.cfg.showNotes) fx.text(x - (x - ARENA.cx) * 0.12, y - (y - ARENA.cy) * 0.12, note, 'ink', 22);
  }

  private breakRing(ring: Ring, withNote = true) {
    ring.broken = true;
    const pts = 48;
    for (let i = 0; i < pts; i++) {
      const a = ring.angle + (i / pts) * TAU;
      let off = a - ring.angle;
      off = Math.atan2(Math.sin(off), Math.cos(off));
      if (Math.abs(off) < ring.gapHalf) continue;
      const x = ARENA.cx + Math.cos(a) * ring.r;
      const y = ARENA.cy + Math.sin(a) * ring.r;
      this.fx.burst(x, y, ring.color, 2, 260, { angle: a, spread: 1.2, size: 5, life: 0.7, grav: 500 });
    }
    this.fx.ring(ARENA.cx, ARENA.cy, ring.color, ring.r + 30, 6, 0.4);
    // Only the song plays — no extra effect sound over it.
    if (withNote) this.playNext();
    if (this.ringsLeft === 0) this.finished = { at: this.time };
  }

  /** Plays the song's next chord (looping) and returns its top note's name. */
  private playNext(): string | null {
    // Rapid-fire bounces (a nearly-full ball) shouldn't machine-gun the synth.
    if (this.time - this.lastNote < 0.045) return null;
    this.lastNote = this.time;
    return this.playEvent(this.events[this.noteIndex % this.events.length]);
  }

  private playEvent(ev: NoteEvent, voice: Voice = 'keys', gain = 1, pan = 0): string {
    this.noteIndex++;
    this.sfx.chord(ev.notes, ev.dur, ev.vel * gain, voice, pan);
    return voice === 'drums' ? '' : noteName(Math.max(...ev.notes));
  }

  /** Seconds since the ending, or -1 while still running. */
  get finishedFor() {
    return this.finished ? this.time - this.finished.at : -1;
  }

  get readyToRestart() {
    return this.finishedFor > FINISH_HOLD;
  }
}

const VIEW_W = 720;
