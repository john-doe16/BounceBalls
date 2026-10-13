import type { Ball } from './ball';
import { ARENA, VIEW, type Game } from './game';
import { drawArrow } from './weapons';

export interface RenderOpts {
  trails: boolean;
  paused: boolean;
  autoRematch: boolean;
}

export function render(ctx: CanvasRenderingContext2D, g: Game, o: RenderOpts) {
  const bg = ctx.createLinearGradient(0, 0, 0, VIEW.h);
  bg.addColorStop(0, '#0b0d1c');
  bg.addColorStop(1, '#151030');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, VIEW.w, VIEW.h);

  drawTitle(ctx, g);
  drawCards(ctx, g);

  const shake = g.fx.shakeOffset();
  ctx.save();
  ctx.translate(shake.x, shake.y);
  drawArena(ctx, g);
  if (o.trails) for (const b of g.balls) if (b.alive) drawTrail(ctx, b);
  for (const a of g.arrows) {
    const s = Math.hypot(a.vx, a.vy) || 1;
    drawArrow(ctx, a.x - (a.vx / s) * 28, a.y - (a.vy / s) * 28, a.x, a.y, a.owner.color);
  }
  for (const b of g.balls) if (b.alive) drawBody(ctx, b);
  for (const b of g.balls) if (b.alive) b.weapon.draw(ctx, b);
  for (const b of g.balls) if (b.alive) drawHpLabel(ctx, b);
  if (g.grab) drawGrab(ctx, g);
  g.fx.draw(ctx);
  ctx.restore();

  if (g.fx.flash > 0) {
    ctx.save();
    ctx.globalAlpha = g.fx.flash * 0.5;
    ctx.fillStyle = g.fx.flashColor;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();
  }

  drawFooter(ctx, g);
  if (g.winner !== undefined) drawWinner(ctx, g, o.autoRematch);
  if (o.paused) drawBanner(ctx, 'PAUSED', '#ffffff', 'press Space to resume');
}

function drawTitle(ctx: CanvasRenderingContext2D, g: Game) {
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.font = '900 44px system-ui, sans-serif';
  if (g.balls.length > 3) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${g.balls.length}-WAY BRAWL`, VIEW.w / 2, 66);
    ctx.restore();
    return;
  }
  // "SWORD vs DAGGER" with each name in its fighter's color.
  const parts: { text: string; color: string; font: string }[] = [];
  g.balls.forEach((b, i) => {
    if (i > 0) parts.push({ text: ' vs ', color: '#8a8fb0', font: '700 30px system-ui, sans-serif' });
    parts.push({ text: b.name, color: b.color, font: '900 44px system-ui, sans-serif' });
  });
  let width = 0;
  for (const p of parts) {
    ctx.font = p.font;
    width += ctx.measureText(p.text).width;
  }
  const scale = Math.min(1, (VIEW.w - 60) / width);
  ctx.translate(VIEW.w / 2 - (width * scale) / 2, 66);
  ctx.scale(scale, scale);
  let x = 0;
  for (const p of parts) {
    ctx.font = p.font;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = p.text === ' vs ' ? 0 : 16;
    ctx.fillText(p.text, x, 0);
    x += ctx.measureText(p.text).width;
  }
  ctx.restore();
}

function drawCards(ctx: CanvasRenderingContext2D, g: Game) {
  const n = g.balls.length;
  const cols = n <= 1 ? 1 : 2;
  const rows = Math.ceil(n / cols);
  const gap = 10;
  const top = 116;
  const area = 214;
  const h = Math.min(rows === 1 ? 130 : 100, (area - (rows - 1) * gap) / rows);
  const w = (VIEW.w - 60 - (cols - 1) * gap) / cols;
  const k = h / 100;

  g.balls.forEach((b, i) => {
    const x = 30 + (i % cols) * (w + gap);
    const y = top + Math.floor(i / cols) * (h + gap);
    ctx.save();
    ctx.globalAlpha = b.alive ? 1 : 0.35;
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.strokeStyle = b.alive ? b.color : '#555';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 14);
    ctx.fill();
    ctx.globalAlpha *= 0.6;
    ctx.stroke();
    ctx.globalAlpha = b.alive ? 1 : 0.35;

    const pad = 14;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.arc(x + pad + 8 * k, y + 26 * k, 8 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `900 ${Math.round(24 * k)}px system-ui, sans-serif`;
    const name = b.name + (b.alive ? '' : '  K.O.');
    const nameEnd = x + pad + 22 * k + ctx.measureText(name).width;
    ctx.fillText(name, x + pad + 22 * k, y + 27 * k);
    // Stats sit right-aligned and shrink to fit whatever room the name leaves.
    const stats = b.weapon.stats(b);
    const room = x + w - pad - nameEnd - 12;
    ctx.font = `700 ${Math.round(17 * k)}px system-ui, sans-serif`;
    const fit = Math.min(1, room / ctx.measureText(stats).width);
    ctx.font = `700 ${Math.max(9, Math.floor(17 * k * fit))}px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.fillStyle = '#c9cde6';
    ctx.fillText(stats, x + w - pad, y + 27 * k);

    const bx = x + pad;
    const by = y + h - 36 * k;
    const bw = w - pad * 2;
    const bh = 22 * k;
    ctx.fillStyle = '#23263d';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, bh / 2);
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(bx, by, (bw * Math.max(0, b.hpLag)) / b.maxHp, bh);
    ctx.fillStyle = b.healGlow > 0 ? '#38ff9c' : b.color;
    ctx.fillRect(bx, by, (bw * b.hp) / b.maxHp, bh);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.font = `900 ${Math.round(16 * k)}px system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    const label = `${Math.ceil(b.hp)} / ${b.maxHp}`;
    ctx.strokeText(label, bx + bw / 2, by + bh / 2 + 1);
    ctx.fillText(label, bx + bw / 2, by + bh / 2 + 1);
    ctx.restore();
  });
}

function arenaPath(ctx: CanvasRenderingContext2D, g: Game) {
  ctx.beginPath();
  if (g.cfg.arena === 'circle') ctx.arc(ARENA.cx, ARENA.cy, ARENA.half, 0, Math.PI * 2);
  else ctx.rect(ARENA.cx - ARENA.half, ARENA.cy - ARENA.half, ARENA.half * 2, ARENA.half * 2);
}

function drawArena(ctx: CanvasRenderingContext2D, g: Game) {
  ctx.save();
  arenaPath(ctx, g);
  ctx.fillStyle = '#0f1226';
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = 'rgba(130,140,255,0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = ARENA.cx - ARENA.half; x <= ARENA.cx + ARENA.half; x += 55) {
    ctx.moveTo(x, ARENA.cy - ARENA.half);
    ctx.lineTo(x, ARENA.cy + ARENA.half);
  }
  for (let y = ARENA.cy - ARENA.half; y <= ARENA.cy + ARENA.half; y += 55) {
    ctx.moveTo(ARENA.cx - ARENA.half, y);
    ctx.lineTo(ARENA.cx + ARENA.half, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.save();
  arenaPath(ctx, g);
  ctx.strokeStyle = '#e8ecff';
  ctx.lineWidth = 6;
  ctx.shadowColor = '#7f8cff';
  ctx.shadowBlur = 22;
  ctx.stroke();
  ctx.restore();
}

function drawTrail(ctx: CanvasRenderingContext2D, b: Ball) {
  ctx.save();
  ctx.fillStyle = b.color;
  const n = b.trail.length;
  b.trail.forEach((p, i) => {
    const k = (i + 1) / n;
    ctx.globalAlpha = k * 0.22;
    ctx.beginPath();
    ctx.arc(p.x, p.y, b.r * (0.4 + 0.55 * k), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function drawBody(ctx: CanvasRenderingContext2D, b: Ball) {
  ctx.save();
  ctx.shadowColor = b.color;
  ctx.shadowBlur = 18;
  const grad = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.25, b.color);
  grad.addColorStop(1, shade(b.color, -0.45));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 3;
  ctx.strokeStyle = shade(b.color, -0.6);
  ctx.stroke();
  if (b.flash > 0) {
    ctx.globalAlpha = b.flash;
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  }
  if (b.healGlow > 0) {
    ctx.globalAlpha = b.healGlow;
    ctx.strokeStyle = '#38ff9c';
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  ctx.restore();
}

function drawHpLabel(ctx: CanvasRenderingContext2D, b: Ball) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 25px system-ui, sans-serif';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  const t = String(Math.ceil(b.hp));
  ctx.strokeText(t, b.x, b.y + 1);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(t, b.x, b.y + 1);
  ctx.restore();
}

function drawGrab(ctx: CanvasRenderingContext2D, g: Game) {
  const { ball, x, y } = g.grab!;
  ctx.save();
  ctx.setLineDash([8, 8]);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ball.x, ball.y);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, ball.r + 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawFooter(ctx: CanvasRenderingContext2D, g: Game) {
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.font = '900 40px system-ui, sans-serif';
  const s = Math.floor(g.time);
  ctx.fillText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, VIEW.w / 2, 1090);
  ctx.fillStyle = '#6d7193';
  ctx.font = '600 20px system-ui, sans-serif';
  ctx.fillText('drag balls to fling  •  Space pause  •  R rematch', VIEW.w / 2, 1150);
  ctx.restore();
}

function drawWinner(ctx: CanvasRenderingContext2D, g: Game, auto: boolean) {
  const t = g.overTime;
  if (t < 0.6) return;
  const sub = auto ? `next round in ${Math.max(0, Math.ceil(4.5 - t))}…` : 'click or press R for a rematch';
  if (g.winner) drawBanner(ctx, `${g.winner.name} WINS!`, g.winner.color, sub, t - 0.6);
  else drawBanner(ctx, 'DRAW!', '#ffffff', sub, t - 0.6);
}

function drawBanner(ctx: CanvasRenderingContext2D, title: string, color: string, sub: string, age = 1) {
  ctx.save();
  ctx.globalAlpha = Math.min(1, age * 4) * 0.55;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, ARENA.cy - 110, VIEW.w, 220);
  ctx.globalAlpha = Math.min(1, age * 4);
  const pop = 1 + 0.4 * Math.max(0, 1 - age * 5);
  ctx.translate(VIEW.w / 2, ARENA.cy - 20);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 68px system-ui, sans-serif';
  const scale = Math.min(1, (VIEW.w - 40) / ctx.measureText(title).width) * pop;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.shadowColor = color;
  ctx.shadowBlur = 30;
  ctx.fillStyle = color;
  ctx.fillText(title, 0, 0);
  ctx.restore();
  ctx.fillStyle = '#e6e8ff';
  ctx.font = '600 24px system-ui, sans-serif';
  ctx.fillText(sub, 0, 62);
  ctx.restore();
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb color. */
function shade(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount);
  const r = f((n >> 16) & 255);
  const gg = f((n >> 8) & 255);
  const b = f(n & 255);
  return `rgb(${r},${gg},${b})`;
}
