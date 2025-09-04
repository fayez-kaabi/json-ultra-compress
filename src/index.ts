import { encodeContainer, decodeContainer } from './container.js';
import { runDecodeTransforms, runEncodeTransforms } from './transform.js';
import { encodeNDJSON, decodeNDJSON, encodeNDJSONColumnar, decodeNDJSONColumnar } from './ndjson.js';
import { codecs as codecRegistry } from './codecs/index.js';
import { utf8Decode, utf8Encode, chooseCodecSample } from './utils.js';
import { brotliCodec } from './codecs/brotli.js';
import { gzipCodec } from './codecs/gzip.js';
import { openColumnar, isColumnarPayload } from './selective-decode.js';
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
  fields?: string[]; // For selective decode - only include these fields
}

// Advanced types
export type { Codec, CodecName, KeyDict, Bitset, ColumnReader, Window, ColumnarHandle } from './types.js';
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

export async function decompressNDJSON(containerBytes: Uint8Array, opts?: DecodeOptions): Promise<string> {
  const { header, body } = decodeContainer(containerBytes);
  const codec = codecs[header.codec];
  const bytes = await codec.decode(body);

  // Check if this is columnar data
  if (isColumnarPayload(bytes)) {
    // === NEW: selective projection ===
    const h = openColumnar(bytes);
    const want = (opts?.fields?.length ? opts.fields : undefined);

    // Decode all valid lines first (like the existing implementation)
    const validLines: string[] = [];
    for (const w of h.windows) {
      if (!want) {
        // Full decode
        for (let i = 0; i < w.numRows; i++) {
          const obj: any = {};
          for (const k of w.keyOrder) {
            const r = w.getReader(k);
            if (r && r.present(i)) obj[k] = r.getValue(i);
          }
          validLines.push(JSON.stringify(obj));
        }
      } else {
        // Selective decode
        const readers: Record<string, import('./types.js').ColumnReader> = {};
        for (const k of want) {
          const r = w.getReader(k);
          if (r) readers[k] = r;
        }

        for (let i = 0; i < w.numRows; i++) {
          const obj: any = {};
          for (const k of want) {
            const r = readers[k];
            if (r && r.present(i)) {
              obj[k] = r.getValue(i);
            }
          }
          validLines.push(JSON.stringify(obj));
        }
      }
    }

    // Reconstruct with empty lines using global line presence
    const globalLinePresence = h.windows[0]?.linePresence;
    if (globalLinePresence) {
      const result: string[] = [];
      let validIndex = 0;

      for (let i = 0; i < globalLinePresence.length; i++) {
        if (globalLinePresence.get(i)) {
          result.push(validLines[validIndex++] || '');
        } else {
          result.push('');
        }
      }

      return result.join("\n");
    } else {
      return validLines.join("\n");
    }
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



