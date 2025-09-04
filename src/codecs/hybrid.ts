import type { Codec } from '../types.js';
import { brotliCodec } from './brotli.js';
import { gzipCodec } from './gzip.js';

// Try to import zstd, fallback gracefully
let zstdCodec: Codec | null = null;
try {
  const zstdModule = await import('./zstd-wasm.js');
  zstdCodec = zstdModule.zstdCodec;
} catch {
  // zstd not available
}

interface WindowChoice {
  codec: string;
  bytes: number;
  ratio: number;
}

interface HybridWindow {
  data: Uint8Array;
  chosenCodec: string;
  originalSize: number;
  compressedSize: number;
}

const SCOUT_SIZE = 4096; // 4KB scout compression for selection

async function chooseWindowCodec(windowData: Uint8Array): Promise<WindowChoice> {
  const scoutSize = Math.min(SCOUT_SIZE, windowData.length);
  const scout = windowData.subarray(0, scoutSize);

  const candidates: Array<{ name: string; codec: Codec }> = [
    { name: 'brotli', codec: brotliCodec },
    { name: 'gzip', codec: gzipCodec }
  ];

  if (zstdCodec && process.env.JSON_OPT_ENABLE_ZSTD === '1') {
    candidates.push({ name: 'zstd', codec: zstdCodec });
  }

  let bestChoice: WindowChoice = { codec: 'brotli', bytes: Infinity, ratio: Infinity };

  for (const candidate of candidates) {
    try {
      const compressed = await candidate.codec.encode(scout);
      const bytes = compressed.length;
      const ratio = bytes / scout.length;

      if (bytes < bestChoice.bytes) {
        bestChoice = { codec: candidate.name, bytes, ratio };
      }
    } catch (error) {
      // Skip codecs that fail
      console.warn(`Hybrid: ${candidate.name} failed on scout:`, error);
    }
  }

  return bestChoice;
}

export const hybridCodec: Codec = {
  name: 'hybrid',

  async encode(input: Uint8Array): Promise<Uint8Array> {
    const DEBUG = process.env.JSON_OPT_DEBUG === '1';
    const SOLID_COMPARE = process.env.JSON_OPT_SOLID_COMPARE !== '0'; // Default on
    const COALESCE_MAJORITY = process.env.JSON_OPT_COALESCE !== '0'; // Default on

    if (DEBUG) {
      console.log('Hybrid encode: input size:', input.length);
    }

    // Always try solid-mode compression for JSON (guarantee parity)
    let solidBest: { codec: string; data: Uint8Array; ratio: number } | null = null;

    if (SOLID_COMPARE) {
      const solidCandidates = [
        { name: 'brotli', codec: brotliCodec },
        { name: 'gzip', codec: gzipCodec }
      ];

      // Always include zstd for potentially better compression
      if (zstdCodec) {
        solidCandidates.push({ name: 'zstd', codec: zstdCodec });
      }

      for (const candidate of solidCandidates) {
        try {
          const compressed = await candidate.codec.encode(input);
          const ratio = compressed.length / input.length;

          if (!solidBest || ratio < solidBest.ratio) {
            solidBest = { codec: candidate.name, data: compressed, ratio };
          }

          if (DEBUG) {
            console.log(`  Solid ${candidate.name}: ${compressed.length} bytes (${ratio.toFixed(3)})`);
          }
        } catch (error) {
          if (DEBUG) {
            console.log(`  Solid ${candidate.name}: FAILED`);
          }
        }
      }
    }

    // Windowed approach
    const CHUNK_SIZE = 64 * 1024; // 64KB chunks
    const windows: HybridWindow[] = [];
    const codecCounts = new Map<string, number>();

    for (let offset = 0; offset < input.length; offset += CHUNK_SIZE) {
      const chunkEnd = Math.min(offset + CHUNK_SIZE, input.length);
      const chunk = input.subarray(offset, chunkEnd);

      // Choose best codec for this chunk
      const choice = await chooseWindowCodec(chunk);

      // Compress with chosen codec
      const codec = choice.codec === 'brotli' ? brotliCodec :
                   choice.codec === 'gzip' ? gzipCodec :
                   choice.codec === 'zstd' ? zstdCodec! :
                   brotliCodec; // fallback to brotli

      const compressed = await codec.encode(chunk);

      windows.push({
        data: compressed,
        chosenCodec: choice.codec,
        originalSize: chunk.length,
        compressedSize: compressed.length
      });

      codecCounts.set(choice.codec, (codecCounts.get(choice.codec) || 0) + 1);

      if (DEBUG) {
        console.log(`  Window ${Math.floor(offset / CHUNK_SIZE)}: ${choice.codec} (${compressed.length}/${chunk.length} = ${(compressed.length/chunk.length).toFixed(3)})`);
      }
    }

    if (DEBUG) {
      console.log('Codec distribution:', Object.fromEntries(codecCounts));
    }

    // Calculate windowed total size
    let windowedTotalSize = 4 + 4; // magic + numWindows
    for (const window of windows) {
      windowedTotalSize += 1 + 4 + 4 + window.data.length; // codec + origSize + compSize + data
    }

    // Coalesce if majority chose same codec
    if (COALESCE_MAJORITY && windows.length > 1) {
      const majorityCodec = Array.from(codecCounts.entries())
        .sort((a, b) => b[1] - a[1])[0];

      const majorityPct = majorityCodec[1] / windows.length;

      if (majorityPct >= 0.9) {
        // Try coalescing with the majority codec
        const codec = majorityCodec[0] === 'brotli' ? brotliCodec :
                     majorityCodec[0] === 'gzip' ? gzipCodec :
                     majorityCodec[0] === 'zstd' ? zstdCodec! :
                     brotliCodec; // fallback to brotli

        try {
          const coalescedData = await codec.encode(input);
          const coalescedSize = coalescedData.length + 20; // Add container overhead estimate

          if (DEBUG) {
            console.log(`  Coalesced ${majorityCodec[0]}: ${coalescedData.length} bytes vs windowed ${windowedTotalSize}`);
          }

          if (coalescedSize < windowedTotalSize) {
            // Use coalesced version - just return the compressed data
            return coalescedData;
          }
        } catch (error) {
          if (DEBUG) {
            console.log(`  Coalesced ${majorityCodec[0]}: FAILED`);
          }
        }
      }
    }

    // Compare with solid-mode if available
    if (solidBest) {
      const solidSize = solidBest.data.length + 20; // Add container overhead estimate

      if (DEBUG) {
        console.log(`  Best solid: ${solidBest.codec} ${solidBest.data.length} bytes vs windowed ${windowedTotalSize}`);
      }

      if (solidSize < windowedTotalSize) {
        // Use solid version - just return the compressed data, don't double-wrap
        return solidBest.data;
      }
    }

    // Serialize: magic + numWindows + [windowHeader + windowData]*
    const magic = utf8Encode('HYB1');
    let totalSize = 4 + 4; // magic + numWindows

    for (const window of windows) {
      totalSize += 1 + 4 + 4 + window.data.length; // codec(u8) + origSize(u32) + compSize(u32) + data
    }

    const result = new Uint8Array(totalSize);
    const dv = new DataView(result.buffer);
    let offset = 0;

    result.set(magic, offset); offset += 4;
    dv.setUint32(offset, windows.length, true); offset += 4;

    for (const window of windows) {
      const codecByte = window.chosenCodec === 'brotli' ? 0 :
                       window.chosenCodec === 'gzip' ? 1 :
                       window.chosenCodec === 'zstd' ? 2 : 0; // fallback to brotli

      result[offset++] = codecByte;
      dv.setUint32(offset, window.originalSize, true); offset += 4;
      dv.setUint32(offset, window.compressedSize, true); offset += 4;
      result.set(window.data, offset); offset += window.data.length;
    }

    return result;
  },

  async decode(input: Uint8Array): Promise<Uint8Array> {
    if (input.length === 0) return new Uint8Array(0);

    // Try to detect format
    const magic = input.length >= 4 ? new TextDecoder().decode(input.subarray(0, 4)) : '';

    // Handle legacy solid format (backward compatibility)
    if (magic === 'SOLI') {
      const fullMagic = new TextDecoder().decode(input.subarray(0, 5));
      if (fullMagic !== 'SOLID') throw new Error('Invalid solid format');

      const codecByte = input[4];
      const codecName = codecByte === 0 ? 'brotli' :
                       codecByte === 1 ? 'gzip' :
                       codecByte === 2 ? 'zstd' : 'brotli'; // fallback to brotli

      const codec = codecName === 'brotli' ? brotliCodec :
                   codecName === 'gzip' ? gzipCodec :
                   codecName === 'zstd' ? zstdCodec! :
                   brotliCodec; // fallback to brotli

      const compressedData = input.subarray(5);
      return await codec.decode(compressedData);
    }

    // Handle windowed format
    if (magic === 'HYB1') {
      const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
      const numWindows = dv.getUint32(4, true);

      const chunks: Uint8Array[] = [];
      let offset = 8;

      for (let i = 0; i < numWindows; i++) {
        const codecByte = input[offset++];
        const origSize = dv.getUint32(offset, true); offset += 4;
        const compSize = dv.getUint32(offset, true); offset += 4;
        const compressedData = input.subarray(offset, offset + compSize);
        offset += compSize;

        const codecName = codecByte === 0 ? 'brotli' :
                         codecByte === 1 ? 'gzip' :
                         codecByte === 2 ? 'zstd' : 'brotli'; // fallback to brotli

        const codec = codecName === 'brotli' ? brotliCodec :
                     codecName === 'gzip' ? gzipCodec :
                     codecName === 'zstd' ? zstdCodec! :
                     brotliCodec; // fallback to brotli

        const decompressed = await codec.decode(compressedData);
        chunks.push(decompressed);
      }

      // Concatenate all chunks
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const result = new Uint8Array(totalLength);
      let resultOffset = 0;

      for (const chunk of chunks) {
        result.set(chunk, resultOffset);
        resultOffset += chunk.length;
      }

      return result;
    }

    // Fallback: treat as raw compressed data (solid mode without wrapper)
    // Try to decompress with each codec until one works
    const codecs = [
      { name: 'brotli', codec: brotliCodec },
      { name: 'gzip', codec: gzipCodec }
    ];

    if (zstdCodec) {
      codecs.push({ name: 'zstd', codec: zstdCodec });
    }

    for (const { codec } of codecs) {
      try {
        return await codec.decode(input);
      } catch {
        // Try next codec
        continue;
      }
    }

    throw new Error('Unable to decompress data with any available codec');
  }
};

function utf8Encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

async function createSolidContainer(codecName: string, data: Uint8Array): Promise<Uint8Array> {
  // Create SHA256 hash of the data
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = new Uint8Array(hashBuffer);
  const sha256 = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');

  // Create container header for solid mode
  const header = {
    version: 1 as const,
    codec: 'hybrid' as const,
    createdAt: new Date().toISOString(),
    ndjson: false,
    keyDictInline: false,
    mode: 'solid' as const,
    params: {
      actualCodec: codecName,
      quality: codecName === 'brotli' ? 11 : undefined,
      windowBits: codecName === 'brotli' ? 24 : undefined
    },
    sha256,
    options: {}
  };

  // Use standard container format
  const { encodeContainer } = await import('../container.js');
  return encodeContainer(header, data);
}

