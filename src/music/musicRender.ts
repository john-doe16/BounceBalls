import { ARENA, VIEW } from '../game';
import { FONT, THEMES, WORLD_TOP, drawClock, drawPaused, zoomAround, type ThemeName } from '../render';
import { INK } from '../weapons';
import { MUSIC_COLORS, type Lane, type MusicGame, type Ring } from './musicGame';
import { PLATFORM_THICK, platformSegment } from './sync';

export interface MusicRenderOpts {
  theme: ThemeName;
  trails: boolean;
  /** Draw the dark outline around the ball. */
  outline: boolean;
  /** Zoom around the middle of the play area; 1 is the normal framing. */
  zoom: number;
  paused: boolean;
  /** Show the bounce count inside the ball (when it's big enough to read). */
  ballNumber: boolean;
}

export function renderMusic(ctx: CanvasRenderingContext2D, m: MusicGame, o: MusicRenderOpts) {
  const t = THEMES[o.theme];
  m.fx.ink = t.text;
  m.fx.paper = t.bg;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  drawHeader(ctx, m, t.text, t.muted, t.track);

  if (m.cfg.format === 'sync' && m.multiLane) {
    drawLanes(ctx, m, t.text, t.track, o);
    drawClock(ctx, m.finished ? m.finished.at : m.time, t);
    if (o.paused) drawPaused(ctx, t);
    return;
  }

  const shake = m.fx.shakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);
  if (m.cfg.format === 'sync') {
    // Open drop: clip to the play area and follow the ball down.
    ctx.beginPath();
    ctx.rect(0, FALL_TOP, VIEW.w, FALL_BOTTOM - FALL_TOP);
    ctx.clip();
    zoomAround(ctx, VIEW.w / 2, (FALL_TOP + FALL_BOTTOM) / 2, o.zoom);
    ctx.translate(VIEW.w / 2 - m.camX, (FALL_TOP + FALL_BOTTOM) / 2 - m.camY);
    drawPlatforms(ctx, m, m.lanes[0], m.camY, t.text, o.zoom);
  } else {
    // Keep a zoomed-in ring from spilling over the title.
    ctx.beginPath();
    ctx.rect(-40, WORLD_TOP - 40, VIEW.w + 80, VIEW.h);
    ctx.clip();
    zoomAround(ctx, ARENA.cx, ARENA.cy, o.zoom);
  }
  if (m.cfg.format === 'escape') {
    for (const r of m.rings) if (!r.broken) drawGapRing(ctx, r);
  } else if (m.rings[0] && !m.rings[0].broken) {
    const ring = m.rings[0];
    ctx.beginPath();
    ctx.arc(ARENA.cx, ARENA.cy, ring.r, 0, Math.PI * 2);
    ctx.fillStyle = t.arena;
    ctx.fill();
    ctx.strokeStyle = ring.flash > 0 ? m.ballColor : t.text;
    ctx.lineWidth = 6 + ring.flash * 4;
    ctx.stroke();
  }

  if (m.cfg.format === 'sync') {
    for (const lane of m.lanes) {
      if (lane.alpha <= 0) continue;
      drawBall(ctx, lane.ball, lane.trail, m.multiLane ? lane.color : m.ballColor, lane.bounces, o, lane.alpha);
    }
  } else {
    drawBall(ctx, m.ball, m.trail, m.ballColor, m.bounces, o, 1);
  }
  m.fx.draw(ctx);
  ctx.restore();

  if (m.fx.flash > 0) {
    ctx.save();
    ctx.globalAlpha = m.fx.flash * 0.5;
    ctx.fillStyle = m.fx.flashColor;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();
  }

  drawClock(ctx, m.finished ? m.finished.at : m.time, t);
  if (o.paused) drawPaused(ctx, t);
}

function drawHeader(ctx: CanvasRenderingContext2D, m: MusicGame, ink: string, muted: string, track: string) {
  const song = m.cfg.song;
  const len = m.events.length;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = ink;
  const title = song.name.toUpperCase();
  ctx.font = `800 60px ${FONT}`;
  const fit = Math.min(1, (VIEW.w - 80) / ctx.measureText(title).width);
  ctx.font = `800 ${Math.floor(60 * fit)}px ${FONT}`;
  ctx.fillText(title, VIEW.w / 2, 196);

  const sub =
    m.cfg.format === 'escape'
      ? `${m.ringsLeft} RINGS LEFT`
      : m.cfg.format === 'grow'
        ? `SIZE ${Math.round((m.ball.r / (ARENA.half - 8)) * 100)}%`
        : `BOUNCE ${m.bounces}`;
  ctx.fillStyle = muted;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(sub, VIEW.w / 2, 236);

  // Where we are in the song.
  const w = 360;
  const x = VIEW.w / 2 - w / 2;
  ctx.fillStyle = track;
  ctx.beginPath();
  ctx.roundRect(x, 262, w, 8, 4);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.roundRect(x, 262, (w * ((m.noteIndex % len) || (m.noteIndex ? len : 0))) / len, 8, 4);
  ctx.fill();
  ctx.restore();
}

const FALL_TOP = 300;
const FALL_BOTTOM = 1040;

/**
 * Beat Sync platforms: short slanted bars, each where the ball meets it on a note. Upcoming ones
 * are drawn ahead so you can see where it lands; used ones flash, then fade away.
 */
function drawPlatforms(ctx: CanvasRenderingContext2D, m: MusicGame, lane: Lane, camY: number, ink: string, zoom: number) {
  const half = (FALL_BOTTOM - FALL_TOP) / 2 / zoom;
  const top = camY - half - 60;
  const bottom = camY + half + 60;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = PLATFORM_THICK;
  for (const h of lane.hits) {
    if (h.p.y < top || h.p.y > bottom) continue;
    const age = m.time - h.t;
    const alpha = age < 0 ? 1 : Math.max(0, 1 - age / 3);
    if (alpha <= 0) continue;
    const seg = platformSegment(h.p, h.n, lane.ball.r, h.half);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = m.multiLane ? lane.color : m.cfg.colorCycle ? MUSIC_COLORS[h.color % MUSIC_COLORS.length] : ink;
    ctx.beginPath();
    ctx.moveTo(seg.a.x, seg.a.y);
    ctx.lineTo(seg.b.x, seg.b.y);
    ctx.stroke();
    if (age >= 0 && age < 0.15) {
      ctx.globalAlpha = 1 - age / 0.15;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** A colored band with its opening cut out; it flashes briefly when the ball hits it. */
function drawGapRing(ctx: CanvasRenderingContext2D, r: Ring) {
  ctx.save();
  ctx.strokeStyle = r.color;
  ctx.lineWidth = r.thick + 0.5;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.arc(ARENA.cx, ARENA.cy, r.r, r.angle + r.gapHalf, r.angle - r.gapHalf + Math.PI * 2);
  ctx.stroke();
  if (r.flash > 0) {
    // Light up on a hit without growing into the neighboring rings.
    ctx.globalAlpha = r.flash * 0.6;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  ctx.restore();
}

/** A ball with its trail, outline and (optionally) its bounce count inside. */
function drawBall(
  ctx: CanvasRenderingContext2D,
  b: { x: number; y: number; r: number },
  trail: { x: number; y: number }[],
  color: string,
  count: number,
  o: MusicRenderOpts,
  alpha: number,
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  if (o.trails) {
    ctx.fillStyle = color;
    trail.forEach((p, i) => {
      const k = (i + 1) / trail.length;
      ctx.globalAlpha = alpha * k * 0.16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.r * (0.5 + 0.45 * k), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = alpha;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  if (o.outline) {
    ctx.lineWidth = Math.min(6, 3 + b.r / 40);
    ctx.strokeStyle = INK;
    ctx.stroke();
  }
  if (o.ballNumber && b.r >= 12) {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(Math.min(b.r * 0.8, 150))}px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.min(8, 3 + b.r / 25);
    ctx.strokeStyle = INK;
    ctx.strokeText(String(count), b.x, b.y + b.r * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(count), b.x, b.y + b.r * 0.04);
  }
  ctx.restore();
}

/**
 * Ball per instrument: each part gets its own column with its own camera, so every ball stays
 * centered in its column while its platforms scroll by at that part's pace.
 */
function drawLanes(ctx: CanvasRenderingContext2D, m: MusicGame, ink: string, divider: string, o: MusicRenderOpts) {
  const mid = (FALL_TOP + FALL_BOTTOM) / 2;
  for (const lane of m.lanes) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(lane.x0, FALL_TOP, lane.x1 - lane.x0, FALL_BOTTOM - FALL_TOP);
    ctx.clip();
    zoomAround(ctx, (lane.x0 + lane.x1) / 2, mid, o.zoom);
    ctx.translate(0, mid - lane.camY);
    drawPlatforms(ctx, m, lane, lane.camY, ink, o.zoom);
    if (lane.alpha > 0) drawBall(ctx, lane.ball, lane.trail, lane.color, lane.bounces, o, lane.alpha);
    lane.fx.draw(ctx);
    ctx.restore();
  }
  ctx.save();
  ctx.strokeStyle = divider;
  ctx.lineWidth = 2;
  for (const lane of m.lanes.slice(1)) {
    ctx.beginPath();
    ctx.moveTo(lane.x0, FALL_TOP + 40);
    ctx.lineTo(lane.x0, FALL_BOTTOM);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 20px ${FONT}`;
  for (const lane of m.lanes) {
    ctx.fillStyle = lane.color;
    ctx.fillText(lane.name, (lane.x0 + lane.x1) / 2, FALL_TOP + 20);
  }
  ctx.restore();
}
