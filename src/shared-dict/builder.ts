import { globby } from 'globby';
import { readFile } from 'fs/promises';

export interface SharedDict {
  type: 'shared';
  createdAt: string;
  dictId: string;
  keys: Record<string, number>; // key -> id
  enums: Record<string, number>; // enum -> id
  subwords: Record<string, number>; // subword -> id
  values: string[]; // legacy
}

// Convert SharedDict to legacy KeyDict format for compatibility
export function sharedDictToKeyDict(sharedDict: SharedDict): import('../types.js').KeyDict {
  const forward: Record<string, string> = {};
  const inverse: Record<string, string> = {};

  // Convert keys to the expected format (key -> short code)
  for (const [key, id] of Object.entries(sharedDict.keys)) {
    const code = `k${id}`; // Use simple k0, k1, k2... format
    forward[key] = code;
    inverse[code] = key;
  }

  return { forward, inverse };
}

export interface BuildOptions { max?: number }

export async function buildSharedDictionary(input: string | string[], opts: BuildOptions = {}): Promise<SharedDict> {
  const paths = await globby(input);
  const keyCounts = new Map<string, number>();
  const enumCounts = new Map<string, number>();
  const subwordCounts = new Map<string, number>();
  const valCounts = new Map<string, number>(); // legacy

  for (const p of paths) {
    try {
      const raw = await readFile(p, 'utf8');
      const lines = p.endsWith('.ndjson') ? raw.split(/\r?\n/).filter(Boolean) : [raw];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          collectAdvanced(obj, keyCounts, enumCounts, subwordCounts, valCounts);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  const maxKeys = opts.max ?? 4096; // Increased capacity
  const maxEnums = 512; // Doubled for better coverage
  const maxSubwords = 1024; // Doubled for better subword coverage

  // Build key dictionary
  const topKeys = Array.from(keyCounts.entries())
    .sort((a,b) => b[1] - a[1])
    .slice(0, maxKeys)
    .map(([k]) => k);

  const keys: Record<string, number> = {};
  for (let i = 0; i < topKeys.length; i++) {
    keys[topKeys[i]] = i;
  }

  // Build enum dictionary (short strings only)
  const topEnums = Array.from(enumCounts.entries())
    .filter(([str, count]) => str.length <= 16 && count > 1)
    .sort((a,b) => b[1] - a[1])
    .slice(0, maxEnums)
    .map(([k]) => k);

  const enums: Record<string, number> = {};
  for (let i = 0; i < topEnums.length; i++) {
    enums[topEnums[i]] = i;
  }

  // Build subword dictionary with PMI scoring
  const totalSubwords = Array.from(subwordCounts.values()).reduce((a, b) => a + b, 0);
  const subwordPmiScores = new Map<string, number>();

  for (const [subword, count] of subwordCounts.entries()) {
    if (subword.length >= 2 && count >= 3) {
      // Simple PMI approximation: log(observed/expected)
      const expected = (subword.length * totalSubwords) / 100000; // Rough baseline
      const pmi = Math.log(count / Math.max(expected, 0.1));
      const score = count * Math.max(0, pmi); // Frequency * PMI
      subwordPmiScores.set(subword, score);
    }
  }

  const topSubwords = Array.from(subwordPmiScores.entries())
    .sort((a,b) => b[1] - a[1]) // Sort by PMI score
    .slice(0, maxSubwords)
    .map(([k]) => k);

  const subwords: Record<string, number> = {};
  for (let i = 0; i < topSubwords.length; i++) {
    subwords[topSubwords[i]] = i;
  }

  // Generate dictionary ID
  const dictContent = JSON.stringify({ keys, enums, subwords });
  const dictId = await generateDictId(dictContent);

  const values = Array.from(valCounts.entries()).sort((a,b)=>b[1]-a[1]).slice(0, maxKeys).map(([k])=>k);

  return {
    type: 'shared',
    createdAt: new Date().toISOString(),
    dictId,
    keys,
    enums,
    subwords,
    values
  };
}

async function generateDictId(content: string): Promise<string> {
  // Use Web Crypto API for SHA-256
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
}

function collectAdvanced(
  obj: unknown,
  keys: Map<string, number>,
  enums: Map<string, number>,
  subwords: Map<string, number>,
  values: Map<string, number>
) {
  if (Array.isArray(obj)) {
    for (const x of obj) collectAdvanced(x, keys, enums, subwords, values);
    return;
  }

  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      // Collect key
      keys.set(key, (keys.get(key) ?? 0) + 1);

      // Collect enum candidates (short strings)
      if (typeof val === 'string') {
        values.set(val, (values.get(val) ?? 0) + 1); // legacy

        if (val.length <= 16) {
          enums.set(val, (enums.get(val) ?? 0) + 1);
        }

        // Collect subwords from strings
        collectSubwords(val, subwords);
      }

      // Collect subwords from keys too
      collectSubwords(key, subwords);

      collectAdvanced(val, keys, enums, subwords, values);
    }
  }
}

function collectSubwords(str: string, subwords: Map<string, number>) {
  // Extract useful subwords (2-6 chars)
  for (let len = 2; len <= Math.min(6, str.length); len++) {
    for (let i = 0; i <= str.length - len; i++) {
      const subword = str.substring(i, i + len);

      // Filter to useful patterns
      if (isUsefulSubword(subword)) {
        subwords.set(subword, (subwords.get(subword) ?? 0) + 1);
      }
    }
  }
}

function isUsefulSubword(subword: string): boolean {
  // Must contain at least one alphanumeric
  if (!/[a-zA-Z0-9]/.test(subword)) return false;

  // Skip pure punctuation
  if (/^[^a-zA-Z0-9]+$/.test(subword)) return false;

  // Prefer common patterns
  return /^[a-zA-Z]+$/.test(subword) || // Pure letters
         /^[0-9]+$/.test(subword) || // Pure digits
         /^[a-zA-Z]+[0-9]+$/.test(subword) || // Letters then digits
         /^[a-zA-Z0-9][._-]/.test(subword) || // Alphanumeric + separator
         /[._-][a-zA-Z0-9]$/.test(subword); // Separator + alphanumeric
}

function collect(obj: unknown, k: Map<string, number>, v: Map<string, number>) {
  if (Array.isArray(obj)) { for (const x of obj) collect(x, k, v); return; }
  if (obj && typeof obj === 'object') {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      k.set(key, (k.get(key) ?? 0) + 1);
      if (typeof val === 'string') v.set(val, (v.get(val) ?? 0) + 1);
      collect(val, k, v);
    }
  }
}


