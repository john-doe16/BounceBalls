// Beat Sync: the ball falls under gravity and bounces off slanted platforms that are placed
// ahead of time, each one exactly where the ball will be when its note is due.

import { rand, type Vec } from '../math';
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
}

/** Notes closer together than this are played as one hit. */
const MERGE = 0.07;
/** Free fall before the first note. */
const LEAD_IN = 0.9;
/** Keep landings inside this horizontal band of the 720px-wide view. */
const X_MIN = 110;
const X_MAX = 610;
const MAX_VX = 650;

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

/**
 * Plans the whole fall. Each hit happens exactly at its note's time; the platform there is tilted
 * so the ball's incoming velocity reflects into a launch aimed at a landing spot that stays on
 * screen when the next note is due.
 */
export function planFall(events: NoteEvent[], start: Vec, g: number): Hit[] {
  const hits: Hit[] = [];
  let p = { ...start };
  let v = { x: 0, y: 0 };
  let t = 0;
  for (let i = 0; i < events.length; i++) {
    const T = i === 0 ? LEAD_IN : Math.max(MERGE, events[i].time - events[i - 1].time);
    const q = { x: p.x + v.x * T, y: p.y + v.y * T + 0.5 * g * T * T };
    const vIn = { x: v.x, y: v.y + g * T };

    // Steer toward a landing spot for the *next* note, kept inside the view.
    const next = i + 1 < events.length ? Math.max(MERGE, events[i + 1].time - events[i].time) : 0.5;
    const reach = Math.min(240, 650 * next);
    let target = q.x + rand(-1, 1) * reach;
    if (Math.abs(target - q.x) < reach * 0.3) target = q.x + Math.sign(target - q.x || 1) * reach * 0.3;
    if (target < X_MIN || target > X_MAX) target = q.x - (target - q.x); // bounce the aim back on screen
    target = Math.min(X_MAX, Math.max(X_MIN, target));
    const vx = Math.max(-MAX_VX, Math.min(MAX_VX, (target - q.x) / next));
    // A little hop on quick notes, a big lob on long ones. Capped so every flight ends lower than
    // it started (the ball keeps falling) and is coming *down* onto the next platform.
    const hop = Math.min(620, 220 + 380 * Math.min(1, next / 0.6)) * rand(0.85, 1.1);
    const vy = -Math.max(20, Math.min(hop, g * next * 0.25));
    // A platform can only push the ball away from its face. If the planned launch would need a
    // push from behind (e.g. speeding up sideways the way it's already going), try the reverse
    // direction, a gentler one, or straight up, and keep the first a real slanted bar could do.
    let vOut = { x: vx, y: vy };
    let n = facing(vIn, vOut);
    for (const k of [-1, 0.5, -0.5, 0]) {
      if (n) break;
      const alt = { x: vx * k, y: vy };
      const land = q.x + alt.x * next;
      if (land < X_MIN - 30 || land > X_MAX + 30) continue;
      n = facing(vIn, alt);
      if (n) vOut = alt;
    }
    if (!n) n = facing(vIn, { x: 0, y: vy }, 0) ?? { x: 0, y: -1 };
    hits.push({ t: t + T, p: q, vIn, vOut, n, ev: events[i], color: i });
    p = q;
    v = vOut;
    t += T;
  }
  return hits;
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
