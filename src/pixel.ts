// Pixel-art sprites. Each sprite is a grid of palette characters; 'c' and 'C' are
// swapped for the fighter's color (and a darker shade), so every weapon carries its team color.

/** Logical canvas units per sprite pixel. */
export const PX = 3;

export type Sprite = readonly string[];

const PALETTE: Record<string, string> = {
  k: '#141414', // outline
  w: '#ffffff', // steel highlight
  s: '#d9dee5', // steel light
  m: '#a7afba', // steel mid
  d: '#6c7581', // steel dark
  b: '#9a6532', // wood
  B: '#5e3b1a', // dark wood
  g: '#f0b429', // gold
  G: '#a8730f', // dark gold
  n: '#3a3f47', // iron
  N: '#22262c', // dark iron
};

const cache = new WeakMap<Sprite, Map<string, HTMLCanvasElement>>();

function bake(rows: Sprite, color: string): HTMLCanvasElement {
  let byColor = cache.get(rows);
  if (!byColor) cache.set(rows, (byColor = new Map()));
  const hit = byColor.get(color);
  if (hit) return hit;

  const w = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = rows.length;
  const ctx = canvas.getContext('2d')!;
  const dark = darken(color, 0.35);
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      const fill = ch === 'c' ? color : ch === 'C' ? dark : PALETTE[ch];
      if (!fill) continue;
      ctx.fillStyle = fill;
      ctx.fillRect(x, y, 1, 1);
    }
  });
  byColor.set(color, canvas);
  return canvas;
}

export function spriteSize(rows: Sprite) {
  return { w: Math.max(...rows.map((r) => r.length)), h: rows.length };
}

/**
 * Draws a sprite with its top-left at (x, y) in the current transform.
 * `flipY` mirrors it across the y = 0 axis (used for weapons that hook to one side).
 */
export function drawSprite(ctx: CanvasRenderingContext2D, rows: Sprite, color: string, x: number, y: number, scale = PX, flipY = false) {
  const img = bake(rows, color);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (flipY) {
    ctx.scale(1, -1);
    y = -y - img.height * scale;
  }
  ctx.drawImage(img, x, y, img.width * scale, img.height * scale);
  ctx.restore();
}

/** Draws a sprite whose middle row sits on the weapon's axis (y = 0). */
export function drawOnAxis(ctx: CanvasRenderingContext2D, rows: Sprite, color: string, x: number, scale = PX) {
  drawSprite(ctx, rows, color, x, (-rows.length * scale) / 2, scale);
}

/** Draws a wooden shaft (a 1×3 pixel texture, stretched) from x0 to x1 along the axis. */
export function drawShaft(ctx: CanvasRenderingContext2D, x0: number, x1: number, scale = PX) {
  const img = bake(SHAFT, '#000');
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, x0, (-SHAFT.length * scale) / 2, x1 - x0, SHAFT.length * scale);
  ctx.restore();
}

function darken(hex: string, amount: number) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

// ---------- sprites (all point right, along +x) ----------

const SHAFT: Sprite = ['k', 'b', 'k'];

export const COLLAR: Sprite = ['.kk.', 'kcck', 'kCCk', 'kcck', '.kk.'];

export const SWORD: Sprite = [
  '.........kkk',
  '.........kgk',
  '.kk......kgk' + 'k'.repeat(18),
  'kcckkkkkkkgkk' + 'w'.repeat(17) + 'k',
  'kCckBbBbBkGkk' + 'm'.repeat(18) + 'k',
  'kcckkkkkkkgkk' + 'd'.repeat(17) + 'k',
  '.kk......kgk' + 'k'.repeat(18),
  '.........kgk',
  '.........kkk',
];

export const DAGGER: Sprite = [
  '.....kkk',
  '.....kgk' + 'k'.repeat(11),
  'kkkkkkgkk' + 'w'.repeat(10) + 'k',
  'kcBbBkGkk' + 'm'.repeat(11) + 'k',
  'kkkkkkgkk' + 'd'.repeat(10) + 'k',
  '.....kgk' + 'k'.repeat(11),
  '.....kkk',
];

export const SPEAR_HEAD: Sprite = [
  '......kkk.....',
  '....kkswwkk...',
  'kckkswwwwwskk.',
  'kCkmmmmmmmmmsk',
  'kckkddddddmkk.',
  '....kkddmkk...',
  '......kkk.....',
];

export const HAMMER_HEAD: Sprite = [
  '.kkkkkkk.',
  'kwsssssdk',
  'kwsmmmmdk',
  'ksmmmmmdk',
  'ksmmmmmdk',
  'kkkkkkkkk',
  'kcCcccCck',
  'kcCcccCck',
  'kcCcccCck',
  'kkkkkkkkk',
  'ksmmmmmdk',
  'ksmmmmmdk',
  'ksmmmmddk',
  'kdddddddk',
  '.kkkkkkk.',
];

/** Hooks downward (+y) and back toward the handle; its top-right pixel attaches to the handle tip. */
export const SCYTHE_BLADE: Sprite = [
  '..........kkkkk',
  '.......kkkksswk',
  '.....kkswwmmmdk',
  '....kswmmmmddk.',
  '...kswmmmddkk..',
  '..kswmmddk.....',
  '..kwmmdk.......',
  '.kswmdk........',
  '.kwmdk.........',
  'kswdk..........',
  'kwmk...........',
  'kwdk...........',
  'kwk............',
  'kwk............',
  'kk.............',
];

/** Limbs curve back toward -x; the grip (team color) is on the right. */
export const BOW: Sprite = [
  'kk.....',
  'kbk....',
  '.kbk...',
  '.kbk...',
  '..kbk..',
  '..kbk..',
  '...kbk.',
  '...kbk.',
  '...kcck',
  '...kCck',
  '...kcck',
  '...kCck',
  '...kcck',
  '...kbk.',
  '...kbk.',
  '..kbk..',
  '..kbk..',
  '.kbk...',
  '.kbk...',
  'kbk....',
  'kk.....',
];

export const MUSKET: Sprite = [
  'kkkk',
  'kbbbkk' + '.'.repeat(25) + 'kk',
  'kbbbbbkk' + 'cc' + 'k'.repeat(23),
  'kbBbbbbg' + 'CC' + 'm'.repeat(22) + 'k',
  'kbbbbbkk' + 'cc' + 'k'.repeat(23),
  'kbbbkk...k' + '.'.repeat(21) + 'kk',
  'kkkk',
];

/** Body centered on column 4, row 8; fuse tip at column 6, row 0. */
export const BOMB: Sprite = [
  '......kk.',
  '.....kbk.',
  '....kbk..',
  '..kccck..',
  '..kkkkk..',
  '.knnnnnk.',
  'knwnnnnnk',
  'knwnnnnnk',
  'knnnnnnNk',
  'knnnnnnNk',
  'knnnnnNNk',
  '.knnNNNk.',
  '..kkkkk..',
];

/** One of the Splitter's spikes, pointing outward along +x. */
export const SPIKE: Sprite = ['kk....', 'kckk..', 'kCssk.', 'kCmmsk', 'kCssk.', 'kckk..', 'kk....'];

export const ARROW: Sprite = [
  'kk.......k..',
  'kcck.....kk.',
  '.kcBbbbbbbsk',
  'kcck.....kk.',
  'kk.......k..',
];
