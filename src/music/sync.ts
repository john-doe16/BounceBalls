// Beat Sync: the ball falls under gravity and bounces off slanted platforms that are placed
// ahead of time, each one exactly where the ball will be when its note is due.

import { closestOnSegment, segmentSegment, type Vec } from '../math';
import type { NoteEvent } from './songs';

/** One platform hit. Between hits the ball flies p + vOut·s + ½g·s² (g along +y). */
export interface Hit {
  /** Song-clock time of the hit. */
  t: number;
  /** Ball center at the moment of the hit. */
  p: Vec;
  vIn: Vec;
  vOut: Vec;
  /** Platform normal (points from the platform toward the ball). */
  n: Vec;
  ev: NoteEvent;
  color: number;
  /** Half the platform's length: shorter on quick notes so a fast run of them doesn't crowd. */
  half: number;
}

/** Notes closer together than this are played as one hit. */
const MERGE = 0.07;
/** Free fall before the first note. */
const LEAD_IN = 0.9;
/** Keep landings inside this horizontal band of the 720px-wide view. */
const X_MIN = 110;
const X_MAX = 610;
const MAX_SPEED = 1600;
/** Platform shape, shared with the renderer. */
export const PLATFORM_HALF = 42;
export const PLATFORM_THICK = 12;
/** How far from the ball's center (at the hit) the platform's middle sits. */
export const platformOffset = (r: number) => r + PLATFORM_THICK / 2;
/** Preferred fall rate, px per second of song: keeps the camera scrolling evenly. */
const DESCENT = 480;
/** Each hit lands at least this much lower than the last, however fast the notes come. */
const MIN_STEP = 72;
/** Only nearby earlier platforms and flights can collide; older ones are far above. */
const LOOKBACK = 60;
const SAMPLES = 12;

/** Combines notes that start within MERGE of each other into single chords. */
export function mergeEvents(events: NoteEvent[]): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && e.time - last.time < MERGE) {
      for (const n of e.notes) if (!last.notes.includes(n)) last.notes.push(n);
      last.dur = Math.max(last.dur, e.dur);
      last.vel = Math.max(last.vel, e.vel);
    } else {
      out.push({ ...e, notes: [...e.notes] });
    }
  }
  return out;
}

export interface PlatformSeg {
  a: Vec;
  b: Vec;
}

/** Platform half-length for a note followed by a gap of `next` seconds. */
const halfFor = (next: number) => Math.max(24, Math.min(PLATFORM_HALF, 260 * next));

/** The platform bar for a hit at ball center `p` with normal `n`. */
export function platformSegment(p: Vec, n: Vec, r: number, half = PLATFORM_HALF): PlatformSeg {
  const off = platformOffset(r);
  const c = { x: p.x - n.x * off, y: p.y - n.y * off };
  const tx = -n.y * half;
  const ty = n.x * half;
  return { a: { x: c.x - tx, y: c.y - ty }, b: { x: c.x + tx, y: c.y + ty } };
}

/** Ball centers along a flight, sampled evenly over its duration (excluding the start). */
function flightPoints(p: Vec, v: Vec, T: number, g: number): Vec[] {
  const pts: Vec[] = [];
  for (let k = 1; k <= SAMPLES; k++) {
    const s = (k / SAMPLES) * T;
    pts.push({ x: p.x + v.x * s, y: p.y + v.y * s + 0.5 * g * s * s });
  }
  return pts;
}

/**
 * Plans the whole fall. Each hit happens exactly at its note's time. At every hit it tries a spread
 * of launches toward the next note and keeps the best one that (1) a real slanted bar could
 * produce, (2) puts its platform clear of other platforms and earlier flight paths, and (3) flies
 * to the next hit without clipping any platform.
 */
export function planFall(events: NoteEvent[], start: Vec, g: number, r: number): Hit[] {
  const hits: Hit[] = [];
  const platforms: PlatformSeg[] = [];
  /** Committed flight paths; the latest one ends at the current hit. */
  const flights: Vec[][] = [];
  let p = { ...start };
  let v = { x: 0, y: 0 };
  let t = 0;
  const clearBall = r + PLATFORM_THICK / 2 + 3;
  const clearPlat = PLATFORM_THICK + 10;

  for (let i = 0; i < events.length; i++) {
    const T = i === 0 ? LEAD_IN : Math.max(MERGE, events[i].time - events[i - 1].time);
    const q = { x: p.x + v.x * T, y: p.y + v.y * T + 0.5 * g * T * T };
    const vIn = { x: v.x, y: v.y + g * T };
    const next = i + 1 < events.length ? Math.max(MERGE, events[i + 1].time - events[i].time) : 0.6;

    const half = halfFor(Math.min(T, next));
    // Fall faster through quick runs of notes so the hits don't stack up.
    const rate = Math.max(DESCENT, MIN_STEP / next);
    const nearPlats = platforms.slice(-LOOKBACK);
    const nearFlights = flights.slice(-LOOKBACK);
    let best: { vOut: Vec; n: Vec; seg: PlatformSeg; path: Vec[]; score: number } | null = null;

    for (const vOut of candidates(q, next, g, rate)) {
      if (Math.hypot(vOut.x, vOut.y) > MAX_SPEED) continue;
      const n = facing(vIn, vOut);
      if (!n) continue;
      const seg = platformSegment(q, n, r, half);
      const path = flightPoints(q, vOut, next, g);
      let clashes = 0;

      // This platform vs the other platforms.
      for (const o of nearPlats) if (segmentSegment(seg.a, seg.b, o.a, o.b).dist < clearPlat) clashes++;
      // This platform vs earlier flights (ignoring the tail of the flight that arrives here).
      nearFlights.forEach((f, k) => {
        const pts = k === nearFlights.length - 1 ? f.slice(0, Math.floor(f.length * 0.75)) : f;
        if (pts.some((pt) => dist(closestOnSegment(pt, seg.a, seg.b), pt) < clearBall)) clashes++;
      });
      // The coming flight vs every platform, including this one once the ball has left it.
      for (const pt of path) for (const o of nearPlats) if (dist(closestOnSegment(pt, o.a, o.b), pt) < clearBall) clashes++;
      for (const pt of path.slice(Math.ceil(SAMPLES * 0.3))) if (dist(closestOnSegment(pt, seg.a, seg.b), pt) < clearBall) clashes++;

      const descent = (path[path.length - 1].y - q.y) / next;
      const zigzag = Math.sign(vOut.x) === Math.sign(v.x) ? 0.3 : 0;
      const score = clashes * 10 + Math.abs(descent - rate) / rate + zigzag + Math.random() * 0.15;
      if (!best || score < best.score) best = { vOut, n, seg, path, score };
    }

    // Nothing made a believable bounce (very rare): pop back up.
    if (!best) {
      const vOut = { x: -vIn.x * 0.5, y: -Math.max(60, Math.abs(vIn.y) * 0.5) };
      const n = facing(vIn, vOut, 0) ?? { x: 0, y: -1 };
      best = { vOut, n, seg: platformSegment(q, n, r, half), path: flightPoints(q, vOut, next, g), score: 0 };
    }

    hits.push({ t: t + T, p: q, vIn, vOut: best.vOut, n: best.n, ev: events[i], color: i, half });
    platforms.push(best.seg);
    flights.push(best.path);
    p = q;
    v = best.vOut;
    t += T;
  }
  return hits;
}

/** A spread of launches: left and right by varying amounts, falling at a few different rates. */
function candidates(q: Vec, next: number, g: number, base: number): Vec[] {
  const reach = Math.max(40, Math.min(260, 520 * next));
  const out: Vec[] = [];
  for (const frac of [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1]) {
    let target = q.x + frac * reach;
    if (target < X_MIN || target > X_MAX) target = q.x - frac * reach; // aim back on screen
    target = Math.min(X_MAX, Math.max(X_MIN, target));
    for (const rate of [base * 0.75, base, base * 1.35, base * 1.8]) {
      // Lands `rate * next` px lower when the next note is due.
      out.push({ x: (target - q.x) / next, y: rate - 0.5 * g * next });
    }
  }
  return out;
}

/**
 * The platform normal that reflects vIn into vOut, or null if the bounce isn't believable:
 * the ball must hit the platform's face and leave from it, each by a clear margin.
 */
function facing(vIn: Vec, vOut: Vec, margin = 0.2): Vec | null {
  const dx = vOut.x - vIn.x;
  const dy = vOut.y - vIn.y;
  const d = Math.hypot(dx, dy);
  if (d < 1) return null;
  const n = { x: dx / d, y: dy / d };
  const inDot = (vIn.x * n.x + vIn.y * n.y) / (Math.hypot(vIn.x, vIn.y) || 1);
  const outDot = (vOut.x * n.x + vOut.y * n.y) / (Math.hypot(vOut.x, vOut.y) || 1);
  return inDot < -margin && outDot > margin ? n : null;
}

function dist(a: Vec, b: Vec) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
