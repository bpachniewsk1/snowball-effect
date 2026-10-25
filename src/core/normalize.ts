// Letters that NFD decomposition doesn't strip (ł is the important one for Polish).
const SPECIAL: Record<string, string> = {
  ł: 'l',
  ß: 'ss',
  æ: 'ae',
  ø: 'o',
  œ: 'oe',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
};

/** Lowercase, strip accents and punctuation, drop ignored words, remove spaces. */
export function normalize(input: string, ignoreWords: string[] = []): string {
  let s = input.toLowerCase().trim();
  s = s.replace(/[łßæøœđðþı]/g, (c) => SPECIAL[c] ?? c);
  s = s.normalize('NFD').replace(/\p{M}/gu, '');
  // Keep C, C++ and C# apart.
  s = s.replace(/\+/g, 'plus').replace(/#/g, 'sharp');
  s = s.replace(/&/g, ' and ').replace(/['’`]/g, '');
  const words = s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const ignore = new Set(['the', ...ignoreWords.map((w) => w.toLowerCase())]);
  const kept = words.filter((w) => !ignore.has(w));
  // Don't let ignore-words erase the whole answer ("The Tempest" -> "tempest", but "Penguin" stays).
  return (kept.length ? kept : words).join('');
}

/** Optimal-string-alignment distance (Levenshtein + adjacent transpositions). */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j++) d[0][j] = j;
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, d[i - 2][j - 2] + 1);
      }
      d[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return d[a.length][b.length];
}

/** How many typos we forgive for an input of this (normalized) length. */
export function typoBudget(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}
