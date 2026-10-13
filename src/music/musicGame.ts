import type { Sfx } from '../audio';
import { Fx } from '../fx';
import { ARENA } from '../game';
import { TAU, rand, type Vec } from '../math';
import { noteName, type Song } from './songs';

export type MusicFormat = 'ring' | 'escape' | 'grow';

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
  /** Set when the run reaches its ending (all rings broken, ball fills the ring). */
  finished: { title: string; at: number } | null = null;
  private acc = 0;
  private hitstop = 0;
  private lastNote = -1;

  constructor(
    public cfg: MusicConfig,
    public sfx: Sfx,
  ) {
    const a = rand(0, TAU);
    const s = rand(380, 520);
    this.ball.vx = Math.cos(a) * s;
    this.ball.vy = Math.sin(a) * s;

    if (cfg.format === 'escape') {
      this.ball.r = 9;
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
      this.ball.r = cfg.format === 'grow' ? 14 : 18;
      this.ball.x = ARENA.cx + rand(-60, 60);
      this.ball.y = ARENA.cy - 120;
      this.rings.push({ r: OUTER, thick: 0, angle: 0, speed: 0, gapHalf: 0, color: '', broken: false, flash: 0 });
    }
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
    }
    for (const r of this.rings) r.flash = Math.max(0, r.flash - realDt * 4);
    this.fx.update(simDt, realDt);
  }

  private step(dt: number) {
    this.time += dt;
    const b = this.ball;
    for (const r of this.rings) r.angle += r.speed * dt;
    if (this.finished && this.cfg.format === 'grow') return; // the full ball holds still

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

  private bounce(x: number, y: number, ring: Ring | undefined) {
    this.bounces++;
    const b = this.ball;
    const note = this.playNext();
    if (ring) ring.flash = 1;
    if (this.cfg.colorCycle) this.color++;

    this.fx.ring(x, y, this.ballColor, 40, 4, 0.35);
    this.fx.burst(x, y, this.ballColor, 8, 220, { size: 4, life: 0.4, grav: 0 });
    if (note && this.cfg.showNotes) this.fx.text(x - (x - ARENA.cx) * 0.12, y - (y - ARENA.cy) * 0.12, note, 'ink', 22);

    if (this.cfg.format === 'grow' && !this.finished) {
      b.r += 2.3;
      if (b.r >= OUTER - 8) {
        b.r = OUTER - 8;
        b.x = ARENA.cx;
        b.y = ARENA.cy;
        this.finish('FULL!');
      }
    }
    if (this.cfg.format === 'ring' && this.cfg.shrink && ring && !this.finished) {
      ring.r = Math.max(b.r * 1.6, ring.r - 2);
      if (ring.r <= b.r * 1.6) this.finish('SQUEEZED!');
    }
  }

  private breakRing(ring: Ring) {
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
    this.fx.shake(6);
    this.hitstop = 0.04;
    this.sfx.shatter();
    this.playNext();
    if (this.ringsLeft === 0) this.finish('ESCAPED!');
  }

  /** Plays the song's next chord (looping) and returns its top note's name. */
  private playNext(): string | null {
    // Rapid-fire bounces (a nearly-full ball) shouldn't machine-gun the synth.
    if (this.time - this.lastNote < 0.045) return null;
    this.lastNote = this.time;
    const events = this.cfg.song.events;
    const ev = events[this.noteIndex % events.length];
    this.noteIndex++;
    this.sfx.chord(ev.notes, ev.dur, ev.vel);
    return noteName(Math.max(...ev.notes));
  }

  private finish(title: string) {
    if (this.finished) return;
    this.finished = { title, at: this.time };
    this.fx.burst(this.ball.x, this.ball.y, this.ballColor, 60, 700, { size: 7, life: 1.1, grav: 300 });
    this.fx.ring(ARENA.cx, ARENA.cy, this.ballColor, OUTER + 40, 10, 0.6);
    this.fx.flash = 0.3;
    this.fx.flashColor = this.ballColor;
    this.fx.shake(14);
    this.sfx.win();
  }

  /** Seconds since the ending, or -1 while still running. */
  get finishedFor() {
    return this.finished ? this.time - this.finished.at : -1;
  }

  get readyToRestart() {
    return this.finishedFor > FINISH_HOLD;
  }
}
