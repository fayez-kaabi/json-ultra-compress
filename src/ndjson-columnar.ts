import type { KeyDict } from './types.js';
import { runEncodeTransforms, runDecodeTransforms } from './transform.js';
import { utf8Decode, utf8Encode } from './utils.js';

interface ColumnarHeader {
  keys: string[];
  rows: number;
}

interface ColumnarPack {
  header: ColumnarHeader;
  presence: string[]; // bitmaps as base64 for each row over keys length (packed bytes)
  columns: Record<string, unknown[]>; // per-key values aligned to rows (undefined when absent)
}

function packBitmap(bits: boolean[]): Uint8Array {
  const len = Math.ceil(bits.length / 8);
  const out = new Uint8Array(len);
  for (let i = 0; i < bits.length; i++) {
    if (bits[i]) out[i >> 3] |= 1 << (i & 7);
  }
  return out;
}

function unpackBitmap(packed: Uint8Array, size: number): boolean[] {
  const out: boolean[] = new Array(size).fill(false);
  for (let i = 0; i < size; i++) {
    out[i] = ((packed[i >> 3] >> (i & 7)) & 1) === 1;
  }
  return out;
}

export function encodeNDJSONColumnar(input: string, dict?: KeyDict | null): Uint8Array {
  const lines = input.split(/\r?\n/).filter((l) => l.length > 0);
  const jsons = lines.map((l) => JSON.parse(l));
  // stable key set
  const keySet = new Set<string>();
  for (const obj of jsons) {
    for (const k of Object.keys(obj)) keySet.add(k);
  }
  const keys = Array.from(keySet).sort();
  const rows = jsons.length;
  const columns: Record<string, unknown[]> = {};
  for (const k of keys) columns[k] = new Array(rows).fill(undefined);
  const presencePacked: string[] = [];
  for (let r = 0; r < rows; r++) {
    const obj = jsons[r];
    const bits: boolean[] = new Array(keys.length).fill(false);
    for (let c = 0; c < keys.length; c++) {
      const k = keys[c];
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        (columns[k] as unknown[])[r] = obj[k];
        bits[c] = true;
      }
    }
    presencePacked.push(Buffer.from(packBitmap(bits)).toString('base64'));
  }
  const pack: ColumnarPack = {
    header: { keys, rows },
    presence: presencePacked,
    columns,
  };
  // Run the standard transforms over the columnar JSON representation
  return runEncodeTransforms(JSON.stringify(pack), { keyDict: dict ?? null });
}

export function decodeNDJSONColumnar(bytes: Uint8Array, dict?: KeyDict | null): string {
  const text = runDecodeTransforms(bytes, { keyDict: dict ?? null });
  const pack = JSON.parse(text) as ColumnarPack;
  const { keys, rows } = pack.header;
  const outLines: string[] = [];
  for (let r = 0; r < rows; r++) {
    const bits = unpackBitmap(Buffer.from(pack.presence[r], 'base64'), keys.length);
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < keys.length; c++) {
      if (bits[c]) {
        const k = keys[c];
        const v = (pack.columns[k] as unknown[])[r];
        obj[k] = v;
      }
    }
    outLines.push(JSON.stringify(obj));
  }
  return outLines.join('\n');
}


