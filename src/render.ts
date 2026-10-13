import type { Ball } from './ball';
import { ARENA, VIEW, WEB_LIFE, type Game, type Team } from './game';
import { PX } from './pixel';
import { INK, drawArrow, drawBombSprite } from './weapons';

export type ThemeName = 'light' | 'dark';

export interface Theme {
  bg: string;
  arena: string;
  text: string;
  muted: string;
  track: string;
}

export const THEMES: Record<ThemeName, Theme> = {
  light: { bg: '#ECEEF1', arena: '#FFFFFF', text: '#111111', muted: '#7A818A', track: '#DADEE4' },
  dark: { bg: '#121212', arena: '#1B1B1B', text: '#F5F5F5', muted: '#7A7A7A', track: '#2C2C2C' },
};

export const FONT = "'Barlow Condensed', 'Arial Narrow', sans-serif";

export interface RenderOpts {
  theme: ThemeName;
  trails: boolean;
  paused: boolean;
  autoRematch: boolean;
}

export function render(ctx: CanvasRenderingContext2D, g: Game, o: RenderOpts) {
  const t = THEMES[o.theme];
  g.fx.ink = t.text;
  g.fx.paper = t.bg;

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  const views = g.teams.map(teamView);
  if (views.length === 2) drawVersus(ctx, views, t);
  else drawStandings(ctx, g, views, t);

  const shake = g.fx.shakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);
  drawArena(ctx, g, t);
  drawWebs(ctx, g, t);
  if (o.trails) for (const b of g.balls) if (b.alive) drawTrail(ctx, b);
  for (const a of g.arrows) {
    if (a.kind === 'bullet') drawBullet(ctx, a.x, a.y, a.vx, a.vy, PX * a.owner.scale);
    else drawArrow(ctx, a.x, a.y, Math.atan2(a.vy, a.vx), a.owner.color, PX * a.owner.scale);
  }
  for (const bomb of g.bombs) drawBomb(ctx, bomb);
  for (const b of g.balls) if (b.alive) drawBody(ctx, b);
  for (const b of g.balls) if (b.alive) b.weapon.draw(ctx, b);
  for (const b of g.balls) if (b.alive) drawHpLabel(ctx, b);
  if (g.grab) drawGrab(ctx, g, t);
  g.fx.draw(ctx);
  ctx.restore();

  if (g.fx.flash > 0) {
    ctx.save();
    ctx.globalAlpha = g.fx.flash * 0.5;
    ctx.fillStyle = g.fx.flashColor;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();
  }

  drawTimer(ctx, g, t);
  if (g.winner !== undefined) drawWinner(ctx, g, o.autoRematch);
  if (o.paused) drawPaused(ctx, t);
}

// ---------- header ----------

/** What the scoreboard shows for one fighter: its pieces' HP summed together. */
interface TeamView {
  name: string;
  color: string;
  alive: boolean;
  hp: number;
  hpLag: number;
  maxHp: number;
  healing: boolean;
  stats: string;
}

function teamView(team: Team): TeamView {
  const live = team.members.filter((b) => b.alive);
  const lead = live[0] ?? team.members[0];
  const sum = (f: (b: Ball) => number) => team.members.reduce((n, b) => n + f(b), 0);
  return {
    name: team.name,
    color: team.color,
    alive: live.length > 0,
    hp: Math.min(team.maxHp, sum((b) => (b.alive ? b.hp : 0))),
    hpLag: Math.min(team.maxHp, sum((b) => Math.max(0, b.hpLag))),
    maxHp: team.maxHp,
    healing: live.some((b) => b.healGlow > 0),
    stats: lead.weapon.stats(lead),
  };
}

/** 1v1 scoreboard: names and HP facing each other, bars draining toward the outside edges. */
function drawVersus(ctx: CanvasRenderingContext2D, views: TeamView[], t: Theme) {
  const [a, b] = views;
  const L = 40;
  const R = VIEW.w - 40;
  const mid = VIEW.w / 2;
  const barW = mid - 30 - L;
  ctx.save();
  ctx.textBaseline = 'alphabetic';

  for (const [ball, side] of [[a, -1], [b, 1]] as const) {
    ctx.globalAlpha = ball.alive ? 1 : 0.4;
    const outer = side < 0 ? L : R;
    const inner = side < 0 ? mid - 30 : mid + 30;

    ctx.textAlign = side < 0 ? 'left' : 'right';
    ctx.fillStyle = ball.color;
    ctx.font = `800 52px ${FONT}`;
    ctx.fillText(ball.name, outer, 210);
    ctx.fillStyle = t.muted;
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(ball.stats, outer, 244);

    ctx.textAlign = side < 0 ? 'right' : 'left';
    ctx.fillStyle = t.text;
    ctx.font = `800 64px ${FONT}`;
    ctx.fillText(ball.alive ? String(Math.ceil(ball.hp)) : 'K.O.', inner, 212);

    const x0 = side < 0 ? L : mid + 30;
    drawBar(ctx, t, ball, x0, 262, barW, 30, side > 0);
  }

  ctx.globalAlpha = 1;
  ctx.textAlign = 'center';
  ctx.fillStyle = t.muted;
  ctx.font = `700 28px ${FONT}`;
  ctx.fillText('VS', mid, 287);
  ctx.restore();
}

/** 3+ fighters: one row each — name, stat, bar, HP. */
function drawStandings(ctx: CanvasRenderingContext2D, g: Game, views: TeamView[], t: Theme) {
  const n = views.length;
  const top = 112;
  const rowH = Math.min(58, 228 / n);
  const k = rowH / 58;
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  ctx.fillStyle = t.muted;
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(`FREE FOR ALL  ·  ${g.teams.filter((tm) => tm.alive).length} LEFT`, VIEW.w / 2, 82);

  views.forEach((b, i) => {
    const y = top + i * rowH + rowH / 2;
    ctx.globalAlpha = b.alive ? 1 : 0.35;
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(52, y, 10 * k, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.font = `800 ${Math.round(34 * k)}px ${FONT}`;
    ctx.fillStyle = t.text;
    ctx.fillText(b.name, 74, y + 1);
    const nameEnd = 74 + ctx.measureText(b.name).width + 12;

    const barX = 360;
    const stats = b.stats;
    ctx.font = `600 ${Math.round(22 * k)}px ${FONT}`;
    const fit = Math.min(1, (barX - 16 - nameEnd) / ctx.measureText(stats).width);
    ctx.font = `600 ${Math.max(10, Math.floor(22 * k * fit))}px ${FONT}`;
    ctx.fillStyle = t.muted;
    ctx.fillText(stats, nameEnd, y + 1);

    drawBar(ctx, t, b, barX, y - 9 * k, 250, 18 * k, false);

    ctx.textAlign = 'right';
    ctx.fillStyle = t.text;
    ctx.font = `800 ${Math.round(34 * k)}px ${FONT}`;
    ctx.fillText(b.alive ? String(Math.ceil(b.hp)) : 'K.O.', VIEW.w - 40, y + 1);
  });
  ctx.restore();
}

function drawBar(ctx: CanvasRenderingContext2D, t: Theme, b: TeamView, x: number, y: number, w: number, h: number, fromRight: boolean) {
  const lag = (w * Math.max(0, b.hpLag)) / b.maxHp;
  const cur = (w * b.hp) / b.maxHp;
  ctx.save();
  ctx.fillStyle = t.track;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = t.text;
  ctx.globalAlpha *= 0.3;
  ctx.fillRect(fromRight ? x + w - lag : x, y, lag, h);
  ctx.globalAlpha /= 0.3;
  ctx.fillStyle = b.healing ? '#1FAA59' : b.color;
  ctx.fillRect(fromRight ? x + w - cur : x, y, cur, h);
  ctx.restore();
}

// ---------- arena ----------

function arenaPath(ctx: CanvasRenderingContext2D, g: Game) {
  ctx.beginPath();
  if (g.cfg.arena === 'circle') ctx.arc(ARENA.cx, ARENA.cy, ARENA.half, 0, Math.PI * 2);
  else ctx.rect(ARENA.cx - ARENA.half, ARENA.cy - ARENA.half, ARENA.half * 2, ARENA.half * 2);
}

function drawArena(ctx: CanvasRenderingContext2D, g: Game, t: Theme) {
  ctx.save();
  arenaPath(ctx, g);
  ctx.fillStyle = t.arena;
  ctx.fill();
  ctx.strokeStyle = t.text;
  ctx.lineWidth = 6;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.restore();
}

/** Spider strands: plain lines from their wall pin to the Spider, fading out at the end of their life. */
function drawWebs(ctx: CanvasRenderingContext2D, g: Game, t: Theme) {
  ctx.save();
  ctx.strokeStyle = t.text;
  ctx.lineWidth = 2;
  for (const w of g.webs) {
    const fade = Math.min(1, (WEB_LIFE - w.age) / 1.5);
    ctx.globalAlpha = 0.6 * fade;
    ctx.beginPath();
    ctx.moveTo(w.a.x, w.a.y);
    ctx.lineTo(w.b.x, w.b.y);
    ctx.stroke();
    ctx.globalAlpha = fade;
    ctx.fillStyle = w.owner.color;
    ctx.fillRect(Math.round(w.a.x / PX) * PX - PX, Math.round(w.a.y / PX) * PX - PX, PX * 2, PX * 2);
  }
  ctx.restore();
}

/** A bomb with a blast-radius warning ring that tightens up as the fuse runs out. */
function drawBomb(ctx: CanvasRenderingContext2D, bomb: Game['bombs'][number]) {
  const k = 1 - bomb.fuse / bomb.maxFuse;
  ctx.save();
  ctx.globalAlpha = 0.1 + 0.35 * k;
  ctx.strokeStyle = bomb.owner.color;
  ctx.lineWidth = 3;
  ctx.setLineDash([PX * 3, PX * 3]);
  ctx.beginPath();
  ctx.arc(bomb.x, bomb.y, bomb.radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.translate(bomb.x, bomb.y);
  const P = PX * bomb.owner.scale;
  // Blinks faster as it gets closer to going off.
  const lit = Math.floor(bomb.fuse * (k > 0.6 ? 16 : 6)) % 2 === 0;
  drawBombSprite(ctx, bomb.owner.color, P, lit);
  if (k > 0.6 && lit) {
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-4 * P, -4 * P, 8 * P, 8 * P);
  }
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, b: Ball) {
  ctx.save();
  ctx.fillStyle = b.color;
  const n = b.trail.length;
  b.trail.forEach((p, i) => {
    const k = (i + 1) / n;
    ctx.globalAlpha = k * 0.14;
    ctx.beginPath();
    ctx.arc(p.x, p.y, b.r * (0.5 + 0.45 * k), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, b: Ball) {
  ctx.save();
  ctx.fillStyle = b.color;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 4 * Math.min(1.25, b.scale);
  ctx.strokeStyle = INK;
  ctx.stroke();
  if (b.flash > 0) {
    ctx.globalAlpha = b.flash * 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  if (b.healGlow > 0) {
    ctx.globalAlpha = b.healGlow;
    ctx.strokeStyle = '#1FAA59';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawHpLabel(ctx: CanvasRenderingContext2D, b: Ball) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.round(30 * b.scale)}px ${FONT}`;
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5 * Math.min(1, b.scale);
  ctx.strokeStyle = INK;
  const s = String(Math.ceil(b.hp));
  ctx.strokeText(s, b.x, b.y + 2);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(s, b.x, b.y + 2);
  ctx.restore();
}

/** A dark pixel ball with a short fading streak behind it. */
function drawBullet(ctx: CanvasRenderingContext2D, x: number, y: number, vx: number, vy: number, P: number) {
  const s = Math.hypot(vx, vy) || 1;
  ctx.save();
  for (let i = 4; i >= 1; i--) {
    ctx.globalAlpha = 0.5 * (1 - i / 5);
    ctx.fillStyle = '#FFB703';
    ctx.fillRect(x - (vx / s) * i * P * 1.6 - P / 2, y - (vy / s) * i * P * 1.6 - P / 2, P, P);
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = INK;
  ctx.fillRect(x - P, y - P, P * 2, P * 2);
  ctx.restore();
}

function drawGrab(ctx: CanvasRenderingContext2D, g: Game, t: Theme) {
  const { ball, x, y } = g.grab!;
  ctx.save();
  ctx.setLineDash([6, 8]);
  ctx.strokeStyle = t.muted;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ball.x, ball.y);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r + 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

// ---------- overlays ----------

function drawTimer(ctx: CanvasRenderingContext2D, g: Game, t: Theme) {
  drawClock(ctx, g.time, t);
}

/** m:ss under the arena. */
export function drawClock(ctx: CanvasRenderingContext2D, time: number, t: Theme) {
  const s = Math.floor(time);
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = t.muted;
  ctx.font = `700 34px ${FONT}`;
  ctx.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, VIEW.w / 2, ARENA.cy + ARENA.half + 52);
  ctx.restore();
}

function drawWinner(ctx: CanvasRenderingContext2D, g: Game, auto: boolean) {
  const age = g.overTime - 0.6;
  if (age < 0) return;
  const color = g.winner?.color ?? '#111111';
  const title = g.winner ? `${g.winner.name} WINS` : 'DRAW';
  const sub = auto ? `NEXT ROUND IN ${Math.max(0, Math.ceil(4.5 - g.overTime))}` : 'CLICK OR PRESS R FOR A REMATCH';
  drawBand(ctx, color, title, sub, age);
}

/** The end-of-round card: a band in `color` that slides open across the arena. */
export function drawBand(ctx: CanvasRenderingContext2D, color: string, title: string, sub: string, age: number) {
  const ink = luminance(color) > 0.6 ? '#111111' : '#ffffff';

  const grow = easeOut(Math.min(1, age / 0.25));
  const w = (ARENA.half * 2 + 40) * grow;
  const h = 170;
  ctx.save();
  ctx.fillStyle = color;
  ctx.fillRect(VIEW.w / 2 - w / 2, ARENA.cy - h / 2, w, h);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.strokeRect(VIEW.w / 2 - w / 2, ARENA.cy - h / 2, w, h);
  if (grow > 0.6) {
    ctx.globalAlpha = (grow - 0.6) / 0.4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = ink;
    ctx.font = `800 96px ${FONT}`;
    const fit = Math.min(1, (ARENA.half * 2 - 20) / ctx.measureText(title).width);
    ctx.font = `800 ${Math.floor(96 * fit)}px ${FONT}`;
    ctx.fillText(title, VIEW.w / 2, ARENA.cy - 14);
    ctx.globalAlpha *= 0.8;
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(sub, VIEW.w / 2, ARENA.cy + 50);
  }
  ctx.restore();
}

export function drawPaused(ctx: CanvasRenderingContext2D, t: Theme) {
  ctx.save();
  ctx.font = `800 36px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = ctx.measureText('PAUSED').width + 48;
  ctx.fillStyle = t.text;
  ctx.beginPath();
  ctx.roundRect(VIEW.w / 2 - w / 2, ARENA.cy - 32, w, 64, 8);
  ctx.fill();
  ctx.fillStyle = t.bg;
  ctx.fillText('PAUSED', VIEW.w / 2, ARENA.cy + 2);
  ctx.restore();
}

const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}
