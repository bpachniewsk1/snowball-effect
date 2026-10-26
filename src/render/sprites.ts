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
  n: '#c8945a', // light leather (boot cuff)
  e: '#3a2418', // boot sole
  m: '#c4c8d4', // metal
  M: '#7a7e8c', // metal, dark
  h: '#ffffff', // shine
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

/** An old boot: fold-over cuff, buckle, heel — and a hole in the toe. */
export const BOOT: Sprite = [
  '....kkkkkkkkkkkkk..',
  '...knnnnbnnnnnBBBk.',
  '...knnnbbnnnnbBBBk.',
  '...knnbbnnnnbbBBBk.',
  '...kkkkkkkkkkkkkkk.',
  '....kbbbbbbbbBBBk..',
  '....kbbnbbbbbBBBk..',
  '....kbbnbbkkkkBBk..',
  '....kbbbbkmmmmkBk..',
  '....kbbbkmMkkmMkk..',
  '...kkbbbkmkhhkmMk..',
  '.kkbbbbbkmMkkmMBk..',
  'kbbbbbbbbkmmmMBBk..',
  'kbnnbkpkbbkkkkBBBk.',
  'kbbbbbkbbbbbbbBBBk.',
  'kBBBBBBBBBBBBBBBBk.',
  'keeeeeeeeeeekeeeek.',
  '.kkkkkkkkkkk.kkkk..',
];

/** A dried-out tree. */
export const DEAD_TREE: Sprite = [
  '.d............d....d.',
  '..d.....d....d....d..',
  '...d....d...d..d.d...',
  '.d..d...d..d....d....',
  '..d..d..d.d....d..d..',
  '...d..d.ddd...d..d...',
  '....d..dddd..d..d....',
  '.....d..ddd.d..d.....',
  '......d.ddddd.d......',
  '.......dddddDd.......',
  '........ddDDd........',
  '........dDDd.........',
  '........dDDd.........',
  '........dDDd.........',
  '........DDDd.........',
  '........DDDD.........',
  '.......DDDDDD........',
  '......DD.DD.DD.......',
];

/** A flower with a big face that smiles and winks at you. */
export const WINK_FLOWER: Sprite = [
  '......ppppp......',
  '....ppppppppp....',
  '...ppyyyyyyypp...',
  '..ppyyyyyyyyypp..',
  '.ppyykkyyyyyyypp.',
  '.ppyykkyyykkkypp.',
  '.ppypyyyyyyyypyp.',
  '.ppykyyyyyyykypp.',
  '..ppykkkkkkkypp..',
  '..ppyyyyyyyyypp..',
  '...ppppppppppp...',
  '.....ppppppp.....',
  '........g........',
  '...ggg..g........',
  '..ggggg.g........',
  '...gggggg........',
  '........g..ggg...',
  '........gggggg...',
  '........g.ggg....',
  '........g........',
  '........g........',
];

/** A small igloo. */
export const IGLOO: Sprite = [
  '.......SSSSSSS.......',
  '....SSSwwwwwwwSSS....',
  '...SwwwSwwwwwSwwwS...',
  '..SwwwwSwwwwwSwwwwS..',
  '..SSSSSSSSSSSSSSSSS..',
  '.SwwwwSwwwwwwSwwwwwS.',
  '.SwwwwSwwkkkwwSwwwwS.',
  'SSSSSSSSkkkkkSSSSSSSS',
  'SwwwwSwwkkkkkwwSwwwwS',
  'SwwwwSwkkkkkkkwSwwwwS',
  'SSSSSSSkkkkkkkSSSSSSS',
];

/** Penguin Caesar: laurel wreath and a red toga. */
export const CAESAR_PENGUIN: Sprite = [
  '....l.l.l.l.l....',
  '...l.lllllll.l...',
  '..l.kkkkkkkkk.l..',
  '...kkkkkkkkkkk...',
  '..kkkwwkkkwwkkk..',
  '..kkkwkkkkkwkkk..',
  '..kkkkkoooookkk..',
  '..kkkkkkookkkkk..',
  '.kkkwwwwwwwwwkkk.',
  '.kkrrrwwwwwwwwkk.',
  '.kkwrrrwwwwwwwkk.',
  '.kkwwrrrwwwwwwkk.',
  '..kwwwrrrwwwwwk..',
  '..kwwwwrrrwwwwk..',
  '...kwwwwrrrwwk...',
  '....kwwwwwrrk....',
  '....ooo...ooo....',
];

/** A fish frozen in a block of ice. */
export const FROZEN_FISH: Sprite = [
  'CCCCCCCCCCCCCCCCCCCCC',
  'CcccccccccccccccccccC',
  'CcWWccccccccccccccccC',
  'CcWcccccccccccccccccC',
  'CcccccccccccccccfcccC',
  'CccccccfffcccccffcccC',
  'CcccfffffffffcfffcccC',
  'CccffkfffffffffffcccC',
  'CccffffffffffffffcccC',
  'CccffffffffffffffcccC',
  'CcccfffffffffcfffcccC',
  'CccccccfffcccccffcWcC',
  'CccccccccccccccccWWcC',
  'CcccccccccccccccccccC',
  'CcccccccccccccccccccC',
  'CCCCCCCCCCCCCCCCCCCCC',
];

/** In order: 100 m, 200 m, … (repeats past 600 m on longer rolls). */
export const ARTIFACTS: Sprite[] = [BOOT, DEAD_TREE, WINK_FLOWER, IGLOO, CAESAR_PENGUIN, FROZEN_FISH];
