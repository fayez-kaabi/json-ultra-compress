import { globby } from 'globby';
import { readFile } from 'fs/promises';
import type { KeyDict } from './types.js';

function* codeGenerator(): Generator<string> {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz';
  let length = 1;
  while (true) {
    const max = Math.pow(alphabet.length, length);
    for (let i = 0; i < max; i++) {
      let n = i;
      let s = '';
      for (let p = 0; p < length; p++) {
        s = alphabet[n % alphabet.length] + s;
        n = Math.floor(n / alphabet.length);
      }
      yield s;
    }
    length++;
  }
}

export interface TrainOptions {
  maxKeys?: number;
}

export async function trainDictionary(glob: string | string[], options: TrainOptions = {}): Promise<KeyDict> {
  const paths = await globby(glob);
  const counts = new Map<string, number>();
  for (const p of paths) {
    try {
      const raw = await readFile(p, 'utf8');
      const lines = p.endsWith('.ndjson') ? raw.split(/\r?\n/).filter(Boolean) : [raw];
      for (const line of lines) {
        try {
          const obj = JSON.parse(line);
          collectKeys(obj, counts);
        } catch {
          // ignore malformed JSON in training
        }
      }
    } catch {
      // ignore file errors
    }
  }
  const entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, options.maxKeys ?? 2048).map(([k]) => k);
  const gen = codeGenerator();
  const forward: Record<string, string> = {};
  const inverse: Record<string, string> = {};
  for (const k of top) {
    const code = gen.next().value as string;
    forward[k] = code;
    inverse[code] = k;
  }
  return { forward, inverse };
}

function collectKeys(obj: unknown, counts: Map<string, number>) {
  if (Array.isArray(obj)) {
    for (const v of obj) collectKeys(v, counts);
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      collectKeys(v, counts);
    }
  }
}


