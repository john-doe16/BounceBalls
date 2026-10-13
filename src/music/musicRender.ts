import { ARENA, VIEW } from '../game';
import { FONT, THEMES, drawBand, drawClock, drawPaused, type ThemeName } from '../render';
import { INK } from '../weapons';
import type { MusicGame, Ring } from './musicGame';

export interface MusicRenderOpts {
  theme: ThemeName;
  trails: boolean;
  paused: boolean;
}

export function renderMusic(ctx: CanvasRenderingContext2D, m: MusicGame, o: MusicRenderOpts) {
  const t = THEMES[o.theme];
  m.fx.ink = t.text;
  m.fx.paper = t.bg;
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  drawHeader(ctx, m, t.text, t.muted, t.track);

  const shake = m.fx.shakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);
  if (m.cfg.format === 'escape') {
    // The outer wall the ball lands in once it's out.
    ctx.strokeStyle = t.text;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(ARENA.cx, ARENA.cy, ARENA.half, 0, Math.PI * 2);
    ctx.fillStyle = t.arena;
    ctx.fill();
    ctx.stroke();
    for (const r of m.rings) if (!r.broken) drawGapRing(ctx, r);
  } else {
    const ring = m.rings[0];
    ctx.beginPath();
    ctx.arc(ARENA.cx, ARENA.cy, ring.r, 0, Math.PI * 2);
    ctx.fillStyle = t.arena;
    ctx.fill();
    ctx.strokeStyle = ring.flash > 0 ? m.ballColor : t.text;
    ctx.lineWidth = 6 + ring.flash * 4;
    ctx.stroke();
  }

  const b = m.ball;
  if (o.trails && !m.finished) {
    ctx.save();
    ctx.fillStyle = m.ballColor;
    m.trail.forEach((p, i) => {
      const k = (i + 1) / m.trail.length;
      ctx.globalAlpha = k * 0.16;
      ctx.beginPath();
      ctx.arc(p.x, p.y, b.r * (0.5 + 0.45 * k), 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }
  ctx.fillStyle = m.ballColor;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = Math.min(6, 3 + b.r / 40);
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (m.cfg.format === 'grow' && b.r > 22) {
    // The bounce count lives inside the growing ball.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `800 ${Math.round(Math.min(b.r * 0.8, 150))}px ${FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.min(8, 3 + b.r / 25);
    ctx.strokeStyle = INK;
    ctx.strokeText(String(m.bounces), b.x, b.y + b.r * 0.04);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(m.bounces), b.x, b.y + b.r * 0.04);
    ctx.restore();
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
  if (m.finished && m.finishedFor > 0.4) {
    drawBand(ctx, m.ballColor, m.finished.title, `${m.bounces} BOUNCES  ·  ${m.finished.at.toFixed(1)}S`, m.finishedFor - 0.4);
  }
  if (o.paused) drawPaused(ctx, t);
}

function drawHeader(ctx: CanvasRenderingContext2D, m: MusicGame, ink: string, muted: string, track: string) {
  const song = m.cfg.song;
  const len = song.events.length;
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
