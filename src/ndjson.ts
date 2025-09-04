import type { KeyDict } from './types.js';
import { runDecodeTransforms, runEncodeTransforms } from './transform.js';
import { utf8Encode, utf8Decode } from './utils.js';

export function encodeNDJSON(input: string, dict?: KeyDict | null): Uint8Array[] {
  // Preserve original line endings and handle BOM
  let processedInput = input;

  // Remove BOM if present
  if (processedInput.charCodeAt(0) === 0xFEFF) {
    processedInput = processedInput.slice(1);
  }

  // Split preserving line endings, keep empty lines
  const lines = processedInput.split(/\r?\n/);
  return lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      // Preserve empty lines as-is
      return utf8Encode(line);
    }
    // If no dictionary, preserve original formatting to avoid unnecessary JSON.parse/stringify
    if (!dict) {
      try {
        // Validate it's valid JSON, but preserve original formatting
        JSON.parse(trimmed);
        return utf8Encode(line); // Use original line with formatting
      } catch {
        // Invalid JSON, fall through to transforms
      }
    }
    return runEncodeTransforms(trimmed, { keyDict: dict ?? null });
  });
}

export function decodeNDJSON(chunks: Uint8Array[], dict?: KeyDict | null): string {
  const lines = chunks.map((chunk) => {
    const text = utf8Decode(chunk);
    // If it's just whitespace, return as-is (empty line preservation)
    if (text.trim().length === 0) {
      return text;
    }
    // If no dictionary, the text should be preserved as-is (no transforms were applied)
    if (!dict) {
      return text;
    }
    // Otherwise, run transforms
    return runDecodeTransforms(chunk, { keyDict: dict ?? null });
  });
  return lines.join('\n');
}

// Shape fingerprint for schema-aware windowing
function computeShapeId(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  return keys.join(',');
}

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

// Import improved columnar implementation
import { encodeNDJSONColumnar as encodeColumnar, decodeNDJSONColumnar as decodeColumnar } from './ndjson/columnar.js';

// Columnar NDJSON encoding (wrapper for compatibility)
export function encodeNDJSONColumnar(input: string, dict?: KeyDict | null, batchSize = 4096): Uint8Array[] {
  return encodeColumnar(input, dict, batchSize);
}

// Legacy implementation (keeping for reference)
function encodeNDJSONColumnarLegacy(input: string, dict?: KeyDict | null, batchSize = 4096): Uint8Array[] {
  const lines = input.split(/\r?\n/).filter((l) => l.length > 0);
  const objects = lines.map(line => JSON.parse(line) as Record<string, unknown>);

  if (objects.length === 0) return [];

  const frames: Uint8Array[] = [];

  // Group by shape and process in batches
  const shapeGroups = new Map<string, Record<string, unknown>[]>();

  for (const obj of objects) {
    const shapeId = computeShapeId(obj);
    if (!shapeGroups.has(shapeId)) {
      shapeGroups.set(shapeId, []);
    }
    shapeGroups.get(shapeId)!.push(obj);
  }

  // Process each shape group in batches
  for (const [shapeId, shapeObjects] of shapeGroups) {
    for (let offset = 0; offset < shapeObjects.length; offset += batchSize) {
      const batch = shapeObjects.slice(offset, Math.min(offset + batchSize, shapeObjects.length));
      const frame = encodeColumnarFrame(batch, shapeId, dict);
      frames.push(frame);
    }
  }

  return frames;
}

function encodeColumnarFrame(objects: Record<string, unknown>[], shapeId: string, dict?: KeyDict | null): Uint8Array {
  if (objects.length === 0) return new Uint8Array([0xC1, 0, 0, 0, 0]);

  // Get sorted key list for this shape
  const keySet = new Set<string>();
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      keySet.add(key);
    }
  }
  const keys = Array.from(keySet).sort();

  const rows = objects.length;
  const shapeHash = hashString(shapeId);

  // Build presence bitmap
  const presenceBits = new Array<boolean>(keys.length * rows);
  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      presenceBits[rowIdx * keys.length + keyIdx] = keys[keyIdx] in objects[rowIdx];
    }
  }

  // Pack presence bitmap into bytes
  const presenceBytes = new Uint8Array(Math.ceil(presenceBits.length / 8));
  for (let i = 0; i < presenceBits.length; i++) {
    if (presenceBits[i]) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      presenceBytes[byteIdx] |= (1 << bitIdx);
    }
  }

  // Encode columns (simplified - just store as JSON for now)
  const columns: Uint8Array[] = [];
  for (const key of keys) {
    const columnValues = objects.map(obj => obj[key] ?? null);
    const columnJson = JSON.stringify(columnValues);
    columns.push(utf8Encode(columnJson));
  }

  // Calculate exact size needed
  let totalSize = 1 + 4 + 4 + 2; // magic + rows + shapeHash + keyCount

  // Add space for keys
  for (const key of keys) {
    totalSize += 4 + utf8Encode(key).length; // length + key bytes
  }

  // Add presence bitmap
  totalSize += presenceBytes.length;

  // Add columns
  for (const col of columns) {
    totalSize += 4 + col.length; // length prefix + data
  }

  const result = new Uint8Array(totalSize);
  const dv = new DataView(result.buffer);
  let offset = 0;

  result[offset++] = 0xC1; // frame magic
  dv.setUint32(offset, rows, true); offset += 4;
  dv.setUint32(offset, shapeHash, true); offset += 4;
  dv.setUint16(offset, keys.length, true); offset += 2;

  // Write key IDs (for now just write the key strings, later integrate with shared dict)
  for (const key of keys) {
    const keyBytes = utf8Encode(key);
    dv.setUint32(offset, keyBytes.length, true); offset += 4;
    result.set(keyBytes, offset); offset += keyBytes.length;
  }

  // Write presence bitmap
  result.set(presenceBytes, offset); offset += presenceBytes.length;

  // Write columns
  for (const col of columns) {
    dv.setUint32(offset, col.length, true); offset += 4;
    result.set(col, offset); offset += col.length;
  }

  return result;
}

export function decodeNDJSONColumnar(frames: Uint8Array[], dict?: KeyDict | null): string {
  return decodeColumnar(frames, dict);
}

function decodeColumnarFrame(frame: Uint8Array, dict?: KeyDict | null): string[] {
  if (frame.length < 5) return [];

  const dv = new DataView(frame.buffer, frame.byteOffset);
  let offset = 0;

  const magic = frame[offset++];
  if (magic !== 0xC1) throw new Error('Invalid columnar frame magic');

  const rows = dv.getUint32(offset, true); offset += 4;
  const shapeHash = dv.getUint32(offset, true); offset += 4;
  const keyCount = dv.getUint16(offset, true); offset += 2;

  if (rows === 0) return [];

  // Read keys (simplified - reading as strings for now)
  const keys: string[] = [];
  for (let i = 0; i < keyCount; i++) {
    const keyLen = dv.getUint32(offset, true); offset += 4;
    const keyBytes = frame.subarray(offset, offset + keyLen);
    keys.push(utf8Decode(keyBytes));
    offset += keyLen;
  }

  // Read presence bitmap
  const presenceBitsCount = keys.length * rows;
  const presenceBytes = Math.ceil(presenceBitsCount / 8);
  const presence = frame.subarray(offset, offset + presenceBytes);
  offset += presenceBytes;

  // Read columns
  const columns: unknown[][] = [];
  for (let i = 0; i < keyCount; i++) {
    const colLen = dv.getUint32(offset, true); offset += 4;
    const colBytes = frame.subarray(offset, offset + colLen);
    const colJson = utf8Decode(colBytes);
    columns.push(JSON.parse(colJson));
    offset += colLen;
  }

  // Reconstruct objects
  const lines: string[] = [];
  for (let rowIdx = 0; rowIdx < rows; rowIdx++) {
    const obj: Record<string, unknown> = {};

    for (let keyIdx = 0; keyIdx < keys.length; keyIdx++) {
      const bitIdx = rowIdx * keys.length + keyIdx;
      const byteIdx = Math.floor(bitIdx / 8);
      const bit = (presence[byteIdx] >> (bitIdx % 8)) & 1;

      if (bit) {
        obj[keys[keyIdx]] = columns[keyIdx][rowIdx];
      }
    }

    lines.push(JSON.stringify(obj));
  }

  return lines;
}


