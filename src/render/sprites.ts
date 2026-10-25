// Pixel sprites as text grids. One character = one pixel, '.' = transparent.

export const PALETTE: Record<string, string> = {
  k: '#1a1c2c', // black / outlines
  w: '#f4f8fc', // snow white
  W: '#ffffff', // highlight
  o: '#f7a541', // beak, feet
  S: '#8aa1b8', // grey-blue outline
  s: '#c5d6e6', // light shade
  r: '#e04f5f', // scarf red
};

export type Sprite = string[];

/** Small front-facing penguin, two waddle frames. */
export const PENGUIN: Sprite[] = [
  [
    '..kkkkk..',
    '.kkwkwkk.',
    '.kkkookk.',
    'kkwwwwwkk',
    'kkwwwwwkk',
    '.kwwwwwk.',
    '.kwwwwwk.',
    '..kwwwk..',
    '..oo.oo..',
  ],
  [
    '..kkkkk..',
    '.kkwkwkk.',
    '.kkkookk.',
    '.kwwwwwkk',
    'kkwwwwwk.',
    '.kwwwwwk.',
    '.kwwwwwk.',
    '..kwwwk..',
    '.oo...oo.',
  ],
];

/** Polar bear walking right, two frames. */
export const POLAR_BEAR: Sprite[] = [
  [
    '................SS..',
    '.....SSSSSSSSS.SwwS.',
    '...SSwwwwwwwwwSSwwwS',
    '..SwwwwwwwwwwwwwwkwS',
    '.Swwwwwwwwwwwwwwwwwk',
    '.SwwwwwwwwwwwwwwwwS.',
    '.SwwwwwwwwwwwwwwwS..',
    '..SwwwSSSSSSSwwwS...',
    '..SwwS.......SwwS...',
    '..SSSS.......SSSS...',
  ],
  [
    '................SS..',
    '.....SSSSSSSSS.SwwS.',
    '...SSwwwwwwwwwSSwwwS',
    '..SwwwwwwwwwwwwwwkwS',
    '.Swwwwwwwwwwwwwwwwwk',
    '.SwwwwwwwwwwwwwwwwS.',
    '.SwwwwwwwwwwwwwwwS..',
    '..SwwwSSSSSSSwwwS...',
    '...SwwS.....SwwS....',
    '...SSSS.....SSSS....',
  ],
];

const cache = new Map<string, HTMLCanvasElement>();

/** Pre-renders a sprite (optionally mirrored) into an offscreen canvas. */
export function spriteCanvas(sprite: Sprite, flip = false): HTMLCanvasElement {
  const id = `${sprite.join('/')}|${flip}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const h = sprite.length;
  const w = Math.max(...sprite.map((r) => r.length));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < sprite[y].length; x++) {
      const ch = sprite[y][x];
      if (ch === '.') continue;
      ctx.fillStyle = PALETTE[ch] ?? '#ff00ff';
      ctx.fillRect(flip ? w - 1 - x : x, y, 1, 1);
    }
  }
  cache.set(id, c);
  return c;
}
