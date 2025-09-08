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
  workers?: number | 'auto' | false; // default false - opt-in worker pool for large jobs
  profile?: 'default' | 'logs';
}

export interface DecodeOptions {
  fields?: string[]; // For selective decode - only include these fields
  workers?: number | 'auto' | false; // default false - opt-in worker pool for large jobs
}

// Advanced types
export type { Codec, CodecName, KeyDict, Bitset, ColumnReader, Window, ColumnarHandle } from './types.js';

// Worker pool types and imports (only in Node.js environment)
interface WorkerMessage {
  id: string;
  mode: 'encode' | 'decode';
  windowBytes: Uint8Array;
  windowIndex: number;
  opts: any;
}

interface WorkerResponse {
  id: string;
  windowIndex: number;
  result?: Uint8Array;
  error?: string;
}

let WorkerPool: any = null;
let shouldUseWorkers: any = null;

// Conditionally import worker pool for Node.js environments
async function loadWorkerPool() {
  try {
    if (typeof process !== 'undefined' && process.versions?.node) {
      const workerModule = await import('./worker-pool.js');
      WorkerPool = workerModule.WorkerPool;
      shouldUseWorkers = workerModule.shouldUseWorkers;
    }
  } catch {
    // Worker pool not available (browser environment or missing dependencies)
  }
}

// Helper to get worker path (only in Node.js)
function getWorkerPath(): string {
  try {
    const { fileURLToPath } = require('url');
    const { resolve } = require('path');
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = resolve(__filename, '..');
    return resolve(__dirname, 'worker-columnar.js');
  } catch {
    throw new Error('Worker pool only available in Node.js environment');
  }
}

// Parallel compression using worker pool with batching
async function compressWithWorkers(chunks: Uint8Array[], codec: CodecName, workerCount: number): Promise<Uint8Array> {
  const pool = new WorkerPool(getWorkerPath(), workerCount);

  try {
    const batchSize = 16; // Process 16 windows at a time to control peak memory
    const results: any[] = new Array(chunks.length);

    // Process chunks in batches to avoid high peak RAM
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batchEnd = Math.min(i + batchSize, chunks.length);
      const batchTasks = [];

      for (let j = i; j < batchEnd; j++) {
        const message: WorkerMessage = {
          id: `compress-${j}`,
          mode: 'encode',
          windowBytes: chunks[j],
          windowIndex: j,
          opts: { codec }
        };
        batchTasks.push(pool.run(message));
      }

      // Wait for this batch to complete
      const batchResults = await Promise.all(batchTasks);

      // Store results in correct positions
      batchResults.forEach(result => {
        results[result.windowIndex] = result;
      });
    }

    // Results are already in correct order due to batching
    // Concatenate compressed chunks with newline separators
    const compressed = results.reduce((acc, result, idx) => {
      if (!result.result) throw new Error(`Compression failed for window ${result.windowIndex}`);

      if (idx > 0) acc.push(utf8Encode('\n'));
      acc.push(result.result);
      return acc;
    }, [] as Uint8Array[]);

    // Combine all compressed chunks
    return compressed.reduce((a: Uint8Array, b: Uint8Array) => {
      const out = new Uint8Array(a.length + b.length);
      out.set(a, 0);
      out.set(b, a.length);
      return out;
    });

  } finally {
    // Always clean up workers, even on error
    await pool.destroy();
  }
}
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
    ? encodeNDJSONColumnar(inputNdjson, opts.keyDict ?? null, undefined, opts.profile ?? 'default')
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

  // Check if we should use worker pool for compression
  await loadWorkerPool();
  const workerCount = shouldUseWorkers ? shouldUseWorkers(
    inputBytes.length,
    chunks.length,
    opts.workers || false,
    opts.columnar || false,
    false // not selective decode
  ) : 0;
  let compressed: Uint8Array;

  if (workerCount > 0 && chunks.length > 1 && WorkerPool) {
    // Use worker pool for parallel compression of chunks
    compressed = await compressWithWorkers(chunks, chosen, workerCount);
  } else {
    // Single-threaded compression (current behavior)
    const codec = codecs[chosen];
    compressed = await codec.encode(inputBytes);
  }
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



