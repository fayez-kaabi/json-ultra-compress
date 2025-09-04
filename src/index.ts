import { encodeContainer, decodeContainer } from './container.js';
import { runDecodeTransforms, runEncodeTransforms } from './transform.js';
import { encodeNDJSON, decodeNDJSON, encodeNDJSONColumnar, decodeNDJSONColumnar } from './ndjson.js';
import { codecs as codecRegistry } from './codecs/index.js';
import { utf8Decode, utf8Encode, chooseCodecSample } from './utils.js';
import { brotliCodec } from './codecs/brotli.js';
import { gzipCodec } from './codecs/gzip.js';
import type { Codec, CodecName, KeyDict, CodecNameOrAuto } from './types';

// Advanced exports  
export const codecs = codecRegistry;

// Public API types
export interface CompressOptions {
  codec?: CodecNameOrAuto;
  keyDict?: KeyDict | null;
  sharedDictId?: string;
  options?: Record<string, unknown>;
}

export interface NDJSONOptions extends CompressOptions {
  columnar?: boolean;
}

export interface DecodeOptions {
  fields?: string[]; // For future selective decode
}

// Advanced types
export type { Codec, CodecName, KeyDict };
function chooseCodec(input: Uint8Array): CodecName {
  return chooseCodecSample(input, (x) => brotliCodec.encode(x) as Uint8Array, (x) => gzipCodec.encode(x) as Uint8Array);
}


export async function compress(inputJson: string, opts: CompressOptions = {}): Promise<Uint8Array> {
  // Environment codec is advisory only - only used if no explicit codec provided
  const envCodec = process.env.JSON_OPT_CODEC;
  const codecName = opts.codec ?? (envCodec && envCodec in codecs ? envCodec as CodecName : 'brotli');
  const chosen = codecName === 'auto' ? chooseCodec(utf8Encode(inputJson)) : codecName;

  // For hybrid codec on JSON, ensure solid comparator always runs
  if (chosen === 'hybrid') {
    // Let the hybrid codec handle the solid comparison internally
    const codec = codecs[chosen];
    const transformed = runEncodeTransforms(inputJson, { keyDict: opts.keyDict ?? null });
    const compressed = await codec.encode(transformed);
    const header = {
      version: 1 as const,
      codec: chosen,
      createdAt: new Date().toISOString(),
      ndjson: false,
      keyDictInline: Boolean(opts.keyDict),
      keyDict: opts.keyDict ?? undefined,
      options: opts.options ?? {},
      sharedDictId: opts.sharedDictId,
    };

    // Internal assertion: header codec must match what actually ran
    if (header.codec !== chosen) {
      throw new Error(`Header codec mismatch: expected ${chosen}, got ${header.codec}`);
    }

    return encodeContainer(header, compressed);
  } else {
    // Standard codec path
    const codec = codecs[chosen];
    const transformed = runEncodeTransforms(inputJson, { keyDict: opts.keyDict ?? null });
    const compressed = await codec.encode(transformed);
    const header = {
      version: 1 as const,
      codec: chosen,
      createdAt: new Date().toISOString(),
      ndjson: false,
      keyDictInline: Boolean(opts.keyDict),
      keyDict: opts.keyDict ?? undefined,
      options: opts.options ?? {},
      sharedDictId: opts.sharedDictId,
    };

    // Internal assertion: header codec must match what actually ran
    if (header.codec !== chosen) {
      throw new Error(`Header codec mismatch: expected ${chosen}, got ${header.codec}`);
    }

    return encodeContainer(header, compressed);
  }
}

export async function decompress(containerBytes: Uint8Array): Promise<string> {
  const { header, body } = decodeContainer(containerBytes);
  const codec = codecs[header.codec];
  const transformed = await codec.decode(body);
  return runDecodeTransforms(transformed, { keyDict: header.keyDictInline ? header.keyDict ?? null : null });
}

export async function compressNDJSON(inputNdjson: string, opts: NDJSONOptions = {}): Promise<Uint8Array> {
  // Environment codec is advisory only - only used if no explicit codec provided
  const envCodec = process.env.JSON_OPT_CODEC;
  const codecName = opts.codec ?? (envCodec && envCodec in codecs ? envCodec as CodecName : 'brotli');
  let chunks = opts.columnar
    ? encodeNDJSONColumnar(inputNdjson, opts.keyDict ?? null)
    : encodeNDJSON(inputNdjson, opts.keyDict ?? null);

  // If columnar encoding returns empty (fallback), use regular NDJSON
  if (opts.columnar && chunks.length === 0) {
    chunks = encodeNDJSON(inputNdjson, opts.keyDict ?? null);
  }
  // Concatenate with simple newline separators (encoded as bytes) before compression
  const joined = chunks.reduce((acc, cur, idx) => {
    if (idx > 0) acc.push(utf8Encode('\n'));
    acc.push(cur);
    return acc;
  }, [] as Uint8Array[]);
  const inputBytes = joined.length ? joined.reduce((a, b) => {
    const out = new Uint8Array(a.length + b.length);
    out.set(a, 0); out.set(b, a.length); return out;
  }) : new Uint8Array();
  const chosen = codecName === 'auto' ? chooseCodec(inputBytes) : codecName;
  const codec = codecs[chosen];
  const compressed = await codec.encode(inputBytes);
  const header = {
    version: 1 as const,
    codec: chosen,
    createdAt: new Date().toISOString(),
    ndjson: true,
    keyDictInline: Boolean(opts.keyDict),
    keyDict: opts.keyDict ?? undefined,
    options: opts.options ?? {},
    sharedDictId: opts.sharedDictId,
  };

  // Internal assertion: header codec must match what actually ran
  if (header.codec !== chosen) {
    throw new Error(`Header codec mismatch: expected ${chosen}, got ${header.codec}`);
  }

  return encodeContainer(header, compressed);
}

export async function decompressNDJSON(containerBytes: Uint8Array): Promise<string> {
  const { header, body } = decodeContainer(containerBytes);
  const codec = codecs[header.codec];
  const bytes = await codec.decode(body);

  // Check if this is columnar data by looking for frame magic bytes (0xC1 or 'BM')
  const COLUMNAR_MAGIC = 0xC1;
  const BITMAP_MAGIC_B = 0x42; // 'B'
  const BITMAP_MAGIC_M = 0x4D; // 'M'

  if (bytes.length > 0 && (bytes[0] === COLUMNAR_MAGIC ||
      (bytes.length >= 2 && bytes[0] === BITMAP_MAGIC_B && bytes[1] === BITMAP_MAGIC_M))) {
    // This is columnar data - parse as binary frames
    const frames = parseColumnarFrames(bytes);
    return decodeNDJSONColumnar(frames, header.keyDictInline ? header.keyDict ?? null : null);
  }

  // Regular NDJSON - run per-line inverse transforms
  const text = utf8Decode(bytes);
  const lines = text.split(/\n/);
  const out = lines.map((l) => {
    const trimmed = l.trim();
    if (trimmed.length === 0) {
      // Preserve empty/whitespace lines as-is
      return l;
    }
    // If no dictionary, preserve original formatting
    if (!header.keyDictInline && !header.keyDict) {
      return l;
    }
    return runDecodeTransforms(utf8Encode(l), { keyDict: header.keyDictInline ? header.keyDict ?? null : null });
  });
  return out.join('\n');
}

function parseColumnarFrames(bytes: Uint8Array): Uint8Array[] {
  const frames: Uint8Array[] = [];
  let offset = 0;

  while (offset < bytes.length) {
    // Skip any newline separators
    while (offset < bytes.length && (bytes[offset] === 0x0A || bytes[offset] === 0x0D)) {
      offset++;
    }

    if (offset >= bytes.length) break;

    const magic = bytes[offset];

    // Handle line presence bitmap frame ('BM')
    if (magic === 0x42 && offset + 1 < bytes.length && bytes[offset + 1] === 0x4D) {
      if (offset + 5 > bytes.length) {
        throw new Error('Incomplete bitmap frame header');
      }

      const dv = new DataView(bytes.buffer, bytes.byteOffset + offset);
      const lineCount = dv.getUint32(2, true); // Skip 'BM' magic (2 bytes)
      const bitmapBytes = Math.ceil(lineCount / 8);
      const frameSize = 6 + bitmapBytes; // 'BM' + lineCount + bitmap

      if (offset + frameSize > bytes.length) {
        throw new Error('Incomplete bitmap frame data');
      }

      frames.push(bytes.subarray(offset, offset + frameSize));
      offset += frameSize;
      continue;
    }

    // Handle columnar frame (0xC1)
    if (magic !== 0xC1) {
      throw new Error('Invalid frame magic at offset ' + offset + ': expected 0xC1 or BM, got 0x' + magic.toString(16));
    }

    // Read frame header to determine frame size
    if (offset + 15 > bytes.length) {
      throw new Error('Incomplete columnar frame header');
    }

    const dv = new DataView(bytes.buffer, bytes.byteOffset + offset);
    const rows = dv.getUint32(1, true); // skip magic byte
    const shapeId = dv.getBigUint64(5, true);
    const keyCount = dv.getUint16(13, true);

    // Calculate frame size by parsing the header
    let frameSize = 15; // magic + rows + shapeId + keyCount
    let frameOffset = offset + 15;

    // Skip keys
    for (let i = 0; i < keyCount; i++) {
      if (frameOffset + 4 > bytes.length) throw new Error('Incomplete key section');
      const keyLen = new DataView(bytes.buffer, bytes.byteOffset + frameOffset).getUint32(0, true);
      frameSize += 4 + keyLen;
      frameOffset += 4 + keyLen;
    }

    // Skip presence bitmap
    const presenceBitsCount = keyCount * rows;
    const presenceBytes = Math.ceil(presenceBitsCount / 8);
    frameSize += presenceBytes;
    frameOffset += presenceBytes;

    // Skip columns
    for (let i = 0; i < keyCount; i++) {
      if (frameOffset + 4 > bytes.length) throw new Error('Incomplete column section');
      const colLen = new DataView(bytes.buffer, bytes.byteOffset + frameOffset).getUint32(0, true);
      frameSize += 4 + colLen;
      frameOffset += 4 + colLen;
    }

    // Extract the complete frame
    if (offset + frameSize > bytes.length) {
      throw new Error('Incomplete columnar frame data');
    }

    frames.push(bytes.subarray(offset, offset + frameSize));
    offset += frameSize;
  }

  return frames;
}


