// Pixel sprites as text grids. One character = one pixel, '.' = transparent.

export const PALETTE: Record<string, string> = {
  k: '#1a1c2c', // black / outlines
  w: '#f4f8fc', // snow white
  W: '#ffffff', // highlight
  o: '#f7a541', // beak, feet
  S: '#8aa1b8', // grey-blue outline
  s: '#c5d6e6', // light shade
  r: '#e04f5f', // scarf / toga red
  b: '#8b5e3c', // leather brown
  B: '#5c3c24', // dark brown
  p: '#f078aa', // petal pink
  y: '#ffd646', // flower yellow
  g: '#56aa5a', // stem green
  l: '#7cc050', // laurel green
  d: '#8a7562', // dead wood
  D: '#5e4e40', // dead wood, dark
  c: '#b4e6fa', // ice
  C: '#6eb4dc', // ice edge
  f: '#ff8c3c', // fish orange
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

// ---------- artifacts on the climb (one beside every 100 m pennant) ----------

/** An old boot with a hole in the toe. */
export const BOOT: Sprite = [
  '...BBBB.......',
  '...BbbB.......',
  '...BbbB.......',
  '...BbbB.......',
  '...BbbbBBBB...',
  '..BbbbbbbbbB..',
  '..BbbbbbbkkbB.',
  '..BbbbbbbkpkbB',
  '..BbbbbbbbkbbB',
  '..kkkkkkkkkkkk',
  '...k.k.k.k.k..',
];

/** A dried-out tree. */
export const DEAD_TREE: Sprite = [
  '.d.......d...',
  '..d..d..d..d.',
  '...d.d.d..d..',
  '.d..dd.d.d...',
  '..d..ddd.d...',
  '...d..dddd...',
  '....d.ddd....',
  '.....dDd.....',
  '......Dd.....',
  '......DD.....',
  '......DD.....',
  '.....DDDD....',
];

/** A flower that smiles and winks at you. */
export const WINK_FLOWER: Sprite = [
  '..ppppppp..',
  '.ppyyyyypp.',
  '.pyykyyyyp.',
  '.pyyyyykkp.',
  '.pykyyykyp.',
  '.ppykkkypp.',
  '..ppppppp..',
  '.....g.....',
  '..gg.g.....',
  '...ggg.....',
  '.....g.gg..',
  '.....ggg...',
  '.....g.....',
];

/** A small igloo. */
export const IGLOO: Sprite = [
  '....SSSSS....',
  '..SSwwwwwSS..',
  '.SwwSwwwSwwS.',
  '.SSSSSSSSSSS.',
  'SwwSwwwwSwwwS',
  'SwwSwkkkSwwwS',
  'SSSSkkkkkSSSS',
];

/** Penguin Caesar: laurel wreath and a red toga. */
export const CAESAR_PENGUIN: Sprite = [
  '..l.lll.l..',
  '.l.kkkkk.l.',
  '..kkwkwkk..',
  '..kkkookk..',
  '.kkwwwwwkk.',
  '.kkrrwwwkk.',
  '..kwrrwwk..',
  '..kwwrrwk..',
  '..kwwwrrk..',
  '...kwwwk...',
  '...oo.oo...',
];

/** A fish frozen in a block of ice. */
export const FROZEN_FISH: Sprite = [
  'CCCCCCCCCCCCC',
  'CcWcccccccccC',
  'CcccccccccccC',
  'CccffffcccfcC',
  'CcfffkffcffcC',
  'CcfffffffffcC',
  'CccffffcccfcC',
  'CcccccccccccC',
  'CcccccccccWcC',
  'CCCCCCCCCCCCC',
];

/** In order: 100 m, 200 m, … (repeats past 600 m on longer rolls). */
export const ARTIFACTS: Sprite[] = [BOOT, DEAD_TREE, WINK_FLOWER, IGLOO, CAESAR_PENGUIN, FROZEN_FISH];
