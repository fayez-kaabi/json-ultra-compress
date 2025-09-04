export function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

export function toUint8Array(buf: ArrayBuffer | Buffer | Uint8Array): Uint8Array {
  if (buf instanceof Uint8Array) return buf;
  // Node Buffer is a Uint8Array subclass; above branch covers it.
  return new Uint8Array(buf as ArrayBuffer);
}

export function concatUint8(arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.byteLength;
  }
  return out;
}

export function writeU32LE(n: number): Uint8Array {
  const b = new Uint8Array(4);
  const v = new DataView(b.buffer);
  v.setUint32(0, n, true);
  return b;
}

export function readU32LE(b: Uint8Array): number {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return v.getUint32(0, true);
}

export function writeU16LE(n: number): Uint8Array {
  const b = new Uint8Array(2);
  const v = new DataView(b.buffer);
  v.setUint16(0, n, true);
  return b;
}

// Heuristic codec chooser: try small brotli/gzip samples; pick smaller
export function chooseCodecSample(input: Uint8Array, brotli: (x: Uint8Array) => Uint8Array, gzip: (x: Uint8Array) => Uint8Array): 'brotli' | 'gzip' {
  const probe = input.subarray(0, Math.min(input.length, 4096));
  let b: Uint8Array; let g: Uint8Array;
  try { b = brotli(probe); } catch { b = new Uint8Array(); }
  try { g = gzip(probe); } catch { g = new Uint8Array(); }
  return (b.byteLength || Infinity) <= (g.byteLength || Infinity) ? 'brotli' : 'gzip';
}


