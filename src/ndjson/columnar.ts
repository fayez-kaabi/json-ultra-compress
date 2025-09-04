// Shape-aware reversible NDJSON columnar encoding

import { utf8Encode, utf8Decode } from '../utils.js';
import type { KeyDict } from '../types.js';

// FNV-1a 64-bit hash for shape fingerprinting
function fnv1a64(data: string): bigint {
  const FNV_OFFSET_BASIS = 14695981039346656037n;
  const FNV_PRIME = 1099511628211n;

  let hash = FNV_OFFSET_BASIS;
  for (let i = 0; i < data.length; i++) {
    hash ^= BigInt(data.charCodeAt(i));
    hash = (hash * FNV_PRIME) & 0xFFFFFFFFFFFFFFFFn;
  }
  return hash;
}

function computeShapeFingerprint(obj: Record<string, unknown>): string {
  return Object.keys(obj).sort().join('\u0001');
}

function computeShapeId(fingerprint: string): bigint {
  return fnv1a64(fingerprint);
}

// Varint encoding/decoding
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value >>> 0; // Ensure unsigned 32-bit

  while (v >= 0x80) {
    bytes.push((v & 0xFF) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0xFF);

  return new Uint8Array(bytes);
}

function decodeVarint(data: Uint8Array, offset: number): { value: number; newOffset: number } {
  let value = 0;
  let shift = 0;
  let pos = offset;

  while (pos < data.length) {
    const byte = data[pos++];
    value |= (byte & 0x7F) << shift;

    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }

  return { value, newOffset: pos };
}

// Column type encodings
enum ColumnType {
  INT_VARINT = 0,
  DELTA_ZIGZAG = 1,
  TIME_DOD = 2,
  BOOL_RLE = 3,
  ENUM_IDS = 4,
  STR_IDS_WITH_RESID = 5,
  RAW_JSON = 6
}

function zigzagEncode(n: number): number {
  return n >= 0 ? n * 2 : (-n * 2) - 1;
}

function zigzagDecode(n: number): number {
  return (n & 1) ? -((n + 1) >> 1) : (n >> 1);
}

function encodeColumn(values: unknown[], key: string): Uint8Array {
  // Analyze column to choose best encoding
  const nonNullValues = values.filter(v => v !== null && v !== undefined);

  if (nonNullValues.length === 0) {
    // All null - use raw JSON
    return encodeRawJsonColumn(values);
  }

  // Check if all are integers
  if (nonNullValues.every(v => typeof v === 'number' && Number.isInteger(v))) {
    const numbers = nonNullValues as number[];
    const min = Math.min(...numbers);
    const max = Math.max(...numbers);

    // Try delta encoding if values are sequential-ish
    if (max - min < numbers.length * 2) {
      return encodeDeltaZigzagColumn(values as (number | null)[]);
    } else {
      return encodeIntVarintColumn(values as (number | null)[]);
    }
  }

  // Check if all are booleans
  if (nonNullValues.every(v => typeof v === 'boolean')) {
    return encodeBoolRleColumn(values as (boolean | null)[]);
  }

  // Check if all are strings and short (enum candidates)
  // Skip enum encoding if any string is empty (to avoid edge cases)
  if (nonNullValues.every(v => typeof v === 'string' && (v as string).length <= 16 && (v as string).length > 0)) {
    const strings = nonNullValues as string[];
    const uniqueStrings = new Set(strings);

    if (uniqueStrings.size <= 16) { // Small enum set
      return encodeEnumIdsColumn(values as (string | null)[]);
    }
  }

  // Skip timestamp encoding for now - use raw JSON to preserve exact format
  // TODO: Fix timestamp encoding to preserve original string format
  // if (key.toLowerCase().includes('time') || key.toLowerCase().includes('date')) {
  //   if (nonNullValues.every(v => typeof v === 'string' || typeof v === 'number')) {
  //     return encodeTimeDodColumn(values);
  //   }
  // }

  // Fallback to raw JSON
  return encodeRawJsonColumn(values);
}

function encodeIntVarintColumn(values: (number | null)[]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([ColumnType.INT_VARINT])];

  for (const value of values) {
    if (value === null || value === undefined) {
      chunks.push(encodeVarint(0)); // Use 0 for null
    } else {
      chunks.push(encodeVarint(zigzagEncode(value) + 1)); // +1 to distinguish from null
    }
  }

  return concatenateUint8Arrays(chunks);
}

function encodeDeltaZigzagColumn(values: (number | null)[]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([ColumnType.DELTA_ZIGZAG])];

  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === null || value === undefined) {
      chunks.push(encodeVarint(0)); // Use 0 for null
    } else {
      if (i === 0) {
        chunks.push(encodeVarint(zigzagEncode(value) + 1));
        prev = value;
      } else {
        const delta = value - prev;
        chunks.push(encodeVarint(zigzagEncode(delta) + 1));
        prev = value;
      }
    }
  }

  return concatenateUint8Arrays(chunks);
}

function encodeTimeDodColumn(values: unknown[]): Uint8Array {
  // Simplified timestamp delta-of-delta encoding
  const chunks: Uint8Array[] = [new Uint8Array([ColumnType.TIME_DOD])];

  const timestamps: number[] = [];
  for (const value of values) {
    if (value === null || value === undefined) {
      timestamps.push(0);
    } else if (typeof value === 'string') {
      timestamps.push(Date.parse(value) || 0);
    } else if (typeof value === 'number') {
      timestamps.push(value);
    } else {
      timestamps.push(0);
    }
  }

  for (let i = 0; i < timestamps.length; i++) {
    if (i < 2) {
      chunks.push(encodeVarint(zigzagEncode(timestamps[i]) + 1));
    } else {
      const delta1 = timestamps[i] - timestamps[i-1];
      const delta2 = timestamps[i-1] - timestamps[i-2];
      const dod = delta1 - delta2;
      chunks.push(encodeVarint(zigzagEncode(dod) + 1));
    }
  }

  return concatenateUint8Arrays(chunks);
}

function encodeBoolRleColumn(values: (boolean | null)[]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([ColumnType.BOOL_RLE])];

  // Simple RLE: encode runs of same value
  let i = 0;
  while (i < values.length) {
    const currentValue = values[i];
    let runLength = 1;

    while (i + runLength < values.length && values[i + runLength] === currentValue) {
      runLength++;
    }

    // Encode: value (0=null, 1=false, 2=true) + run length
    const valueCode = currentValue === null ? 0 : currentValue ? 2 : 1;
    chunks.push(new Uint8Array([valueCode]));
    chunks.push(encodeVarint(runLength));

    i += runLength;
  }

  return concatenateUint8Arrays(chunks);
}

function encodeEnumIdsColumn(values: (string | null)[]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([ColumnType.ENUM_IDS])];

  // Build enum mapping
  const nonNullStrings = values.filter(v => v !== null) as string[];
  const uniqueStrings = Array.from(new Set(nonNullStrings)).sort();

  // Write enum count and strings
  chunks.push(new Uint8Array([uniqueStrings.length]));
  for (const str of uniqueStrings) {
    const strBytes = utf8Encode(str);
    chunks.push(encodeVarint(strBytes.length));
    chunks.push(strBytes);
  }

  // Write enum IDs
  for (const value of values) {
    if (value === null) {
      chunks.push(new Uint8Array([255])); // 255 = null
    } else {
      const id = uniqueStrings.indexOf(value);
      chunks.push(new Uint8Array([id]));
    }
  }

  return concatenateUint8Arrays(chunks);
}

function encodeRawJsonColumn(values: unknown[]): Uint8Array {
  const chunks: Uint8Array[] = [new Uint8Array([ColumnType.RAW_JSON])];

  for (const value of values) {
    const json = JSON.stringify(value);
    const jsonBytes = utf8Encode(json);
    chunks.push(encodeVarint(jsonBytes.length));
    chunks.push(jsonBytes);
  }

  return concatenateUint8Arrays(chunks);
}

function concatenateUint8Arrays(arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

export interface ColumnarFrame {
  magic: number; // 0xC1
  rows: number;
  shapeId: bigint;
  keys: string[];
  presence: Uint8Array;
  columns: Uint8Array[];
}

export function encodeColumnarBatch(objects: Record<string, unknown>[], shapeId: bigint, dict?: KeyDict | null): Uint8Array {
  if (objects.length === 0) return new Uint8Array([0xC1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  // Get sorted key list for this shape
  const keySet = new Set<string>();
  for (const obj of objects) {
    for (const key of Object.keys(obj)) {
      keySet.add(key);
    }
  }
  const keys = Array.from(keySet).sort();

  const rows = objects.length;

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

  // Encode columns
  const columns: Uint8Array[] = [];
  for (const key of keys) {
    const columnValues = objects.map(obj => obj[key] ?? null);
    const encodedColumn = encodeColumn(columnValues, key);
    columns.push(encodedColumn);
  }

  // Calculate total size
  let totalSize = 1 + 4 + 8 + 2; // magic + rows + shapeId + keyCount

  // Add space for keys (as strings for now, later integrate with shared dict)
  for (const key of keys) {
    const keyBytes = utf8Encode(key);
    totalSize += 4 + keyBytes.length; // length + key bytes
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
  dv.setBigUint64(offset, shapeId, true); offset += 8;
  dv.setUint16(offset, keys.length, true); offset += 2;

  // Write keys
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

export function encodeNDJSONColumnar(input: string, dict?: KeyDict | null, batchSize = 4096): Uint8Array[] {
  // Handle BOM and preserve line ending style
  let processedInput = input;

  // Remove BOM if present
  if (processedInput.charCodeAt(0) === 0xFEFF) {
    processedInput = processedInput.slice(1);
  }

  // Split lines preserving empty ones
  const allLines = processedInput.split(/\r?\n/);
  const objects: (Record<string, unknown> | null)[] = [];
  const linePresence: boolean[] = [];

  for (const line of allLines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      // Empty line - preserve it
      objects.push(null);
      linePresence.push(false);
    } else {
      try {
        const obj = JSON.parse(trimmed) as Record<string, unknown>;
        objects.push(obj);
        linePresence.push(true);
      } catch {
        // Invalid JSON - treat as empty line
        objects.push(null);
        linePresence.push(false);
      }
    }
  }

  if (objects.length === 0) return [];

  // Disable columnar for tiny windows
  const validObjects = objects.filter(obj => obj !== null) as Record<string, unknown>[];
  if (validObjects.length < 3 || input.length < 64) {
    // Fall back to regular NDJSON encoding - return empty to signal fallback
    return [];
  }

  const frames: Uint8Array[] = [];

  // Encode line presence bitmap first
  const presenceBitmap = encodeLinePresenceBitmap(linePresence);
  frames.push(presenceBitmap);

  // Group valid objects by shape fingerprint
  const shapeGroups = new Map<string, { objects: Record<string, unknown>[]; shapeId: bigint }>();

  for (const obj of validObjects) {
    const fingerprint = computeShapeFingerprint(obj);
    if (!shapeGroups.has(fingerprint)) {
      shapeGroups.set(fingerprint, {
        objects: [],
        shapeId: computeShapeId(fingerprint)
      });
    }
    shapeGroups.get(fingerprint)!.objects.push(obj);
  }

  // Process each shape group in batches
  for (const { objects: shapeObjects, shapeId } of shapeGroups.values()) {
    for (let offset = 0; offset < shapeObjects.length; offset += batchSize) {
      const batch = shapeObjects.slice(offset, Math.min(offset + batchSize, shapeObjects.length));
      const frame = encodeColumnarBatch(batch, shapeId, dict);
      frames.push(frame);
    }
  }

  return frames;
}

function encodeLinePresenceBitmap(linePresence: boolean[]): Uint8Array {
  // Special frame for line presence: magic 'BM' + line count + bitmap
  const bitmapBytes = Math.ceil(linePresence.length / 8);
  const result = new Uint8Array(2 + 4 + bitmapBytes);
  const dv = new DataView(result.buffer);

  result[0] = 0x42; // 'B'
  result[1] = 0x4D; // 'M'
  dv.setUint32(2, linePresence.length, true);

  // Pack bitmap
  for (let i = 0; i < linePresence.length; i++) {
    if (linePresence[i]) {
      const byteIdx = Math.floor(i / 8);
      const bitIdx = i % 8;
      result[6 + byteIdx] |= (1 << bitIdx);
    }
  }

  return result;
}

export function decodeNDJSONColumnar(frames: Uint8Array[], dict?: KeyDict | null): string {
  if (frames.length === 0) return '';

  // Check if first frame is a line presence bitmap
  let linePresence: boolean[] | null = null;
  let frameOffset = 0;

  if (frames[0].length >= 2 && frames[0][0] === 0x42 && frames[0][1] === 0x4D) {
    linePresence = decodeLinePresenceBitmap(frames[0]);
    frameOffset = 1;
  }

  // If we have line presence info, use it to reconstruct with empty lines
  if (linePresence) {
    const validLines: string[] = [];

    // Decode all columnar frames
    for (let i = frameOffset; i < frames.length; i++) {
      const lines = decodeColumnarFrame(frames[i], dict);
      validLines.push(...lines);
    }

    // Reconstruct with empty lines
    const result: string[] = [];
    let validIndex = 0;

    for (const isPresent of linePresence) {
      if (isPresent) {
        result.push(validLines[validIndex++] || '');
      } else {
        result.push('');
      }
    }

    return result.join('\n');
  }

  // No line presence info - decode normally
  const allLines: string[] = [];
  for (const frame of frames) {
    const lines = decodeColumnarFrame(frame, dict);
    allLines.push(...lines);
  }

  return allLines.join('\n');
}

function decodeLinePresenceBitmap(frame: Uint8Array): boolean[] {
  if (frame.length < 6 || frame[0] !== 0x42 || frame[1] !== 0x4D) {
    throw new Error('Invalid line presence bitmap');
  }

  const dv = new DataView(frame.buffer, frame.byteOffset);
  const lineCount = dv.getUint32(2, true);
  const bitmapBytes = Math.ceil(lineCount / 8);

  if (frame.length < 6 + bitmapBytes) {
    throw new Error('Incomplete line presence bitmap');
  }

  const result: boolean[] = [];
  for (let i = 0; i < lineCount; i++) {
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    const bit = (frame[6 + byteIdx] >> bitIdx) & 1;
    result.push(bit === 1);
  }

  return result;
}

function decodeColumnarFrame(frame: Uint8Array, dict?: KeyDict | null): string[] {
  if (frame.length < 15) return []; // Minimum size for header

  const dv = new DataView(frame.buffer, frame.byteOffset);
  let offset = 0;

  const magic = frame[offset++];
  if (magic !== 0xC1) throw new Error('Invalid columnar frame magic');

  const rows = dv.getUint32(offset, true); offset += 4;
  const shapeId = dv.getBigUint64(offset, true); offset += 8;
  const keyCount = dv.getUint16(offset, true); offset += 2;

  if (rows === 0) return [];

  // Read keys
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

  // Read and decode columns
  const columns: unknown[][] = [];
  for (let i = 0; i < keyCount; i++) {
    const colLen = dv.getUint32(offset, true); offset += 4;
    const colBytes = frame.subarray(offset, offset + colLen);
    const colValues = decodeColumn(colBytes, rows);
    columns.push(colValues);
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
        const value = columns[keyIdx][rowIdx];
        // Include the key even if value is null (explicit null vs missing key)
        obj[keys[keyIdx]] = value;
      }
    }

    lines.push(JSON.stringify(obj));
  }

  return lines;
}

function decodeColumn(data: Uint8Array, rows: number): unknown[] {
  if (data.length === 0) return new Array(rows).fill(null);

  const type = data[0] as ColumnType;
  const payload = data.subarray(1);

  switch (type) {
    case ColumnType.INT_VARINT:
      return decodeIntVarintColumn(payload, rows);
    case ColumnType.DELTA_ZIGZAG:
      return decodeDeltaZigzagColumn(payload, rows);
    case ColumnType.TIME_DOD:
      return decodeTimeDodColumn(payload, rows);
    case ColumnType.BOOL_RLE:
      return decodeBoolRleColumn(payload, rows);
    case ColumnType.ENUM_IDS:
      return decodeEnumIdsColumn(payload, rows);
    case ColumnType.RAW_JSON:
      return decodeRawJsonColumn(payload, rows);
    default:
      return new Array(rows).fill(null);
  }
}

function decodeIntVarintColumn(data: Uint8Array, rows: number): (number | null)[] {
  const result: (number | null)[] = [];
  let offset = 0;

  for (let i = 0; i < rows; i++) {
    const { value, newOffset } = decodeVarint(data, offset);
    offset = newOffset;

    if (value === 0) {
      result.push(null);
    } else {
      result.push(zigzagDecode(value - 1));
    }
  }

  return result;
}

function decodeDeltaZigzagColumn(data: Uint8Array, rows: number): (number | null)[] {
  const result: (number | null)[] = [];
  let offset = 0;
  let prev = 0;

  for (let i = 0; i < rows; i++) {
    const { value, newOffset } = decodeVarint(data, offset);
    offset = newOffset;

    if (value === 0) {
      result.push(null);
    } else {
      if (i === 0) {
        prev = zigzagDecode(value - 1);
        result.push(prev);
      } else {
        const delta = zigzagDecode(value - 1);
        prev = prev + delta;
        result.push(prev);
      }
    }
  }

  return result;
}

function decodeTimeDodColumn(data: Uint8Array, rows: number): unknown[] {
  const result: unknown[] = [];
  let offset = 0;
  const timestamps: number[] = [];

  for (let i = 0; i < rows; i++) {
    const { value, newOffset } = decodeVarint(data, offset);
    offset = newOffset;

    if (value === 0) {
      timestamps.push(0);
      result.push(null);
    } else {
      if (i < 2) {
        const ts = zigzagDecode(value - 1);
        timestamps.push(ts);
        // Convert back to ISO string if it looks like a timestamp
        if (ts > 1000000000000) { // Looks like a millisecond timestamp
          result.push(new Date(ts).toISOString());
        } else {
          result.push(ts);
        }
      } else {
        const dod = zigzagDecode(value - 1);
        const delta1 = (timestamps[i-1] - timestamps[i-2]) + dod;
        const ts = timestamps[i-1] + delta1;
        timestamps.push(ts);
        // Convert back to ISO string if it looks like a timestamp
        if (ts > 1000000000000) { // Looks like a millisecond timestamp
          result.push(new Date(ts).toISOString());
        } else {
          result.push(ts);
        }
      }
    }
  }

  return result;
}

function decodeBoolRleColumn(data: Uint8Array, rows: number): (boolean | null)[] {
  const result: (boolean | null)[] = [];
  let offset = 0;

  while (result.length < rows && offset < data.length) {
    const valueCode = data[offset++];
    const { value: runLength, newOffset } = decodeVarint(data, offset);
    offset = newOffset;

    const value = valueCode === 0 ? null : valueCode === 2;

    for (let i = 0; i < runLength && result.length < rows; i++) {
      result.push(value);
    }
  }

  // Pad with nulls if needed
  while (result.length < rows) {
    result.push(null);
  }

  return result;
}

function decodeEnumIdsColumn(data: Uint8Array, rows: number): (string | null)[] {
  let offset = 0;

  // Read enum strings
  const enumCount = data[offset++];
  const enumStrings: string[] = [];

  for (let i = 0; i < enumCount; i++) {
    const { value: strLen, newOffset } = decodeVarint(data, offset);
    offset = newOffset;
    const strBytes = data.subarray(offset, offset + strLen);
    enumStrings.push(utf8Decode(strBytes));
    offset += strLen;
  }

  // Read enum IDs
  const result: (string | null)[] = [];
  for (let i = 0; i < rows; i++) {
    const id = data[offset++];
    if (id === 255) {
      result.push(null);
    } else {
      result.push(enumStrings[id] || null);
    }
  }

  return result;
}

function decodeRawJsonColumn(data: Uint8Array, rows: number): unknown[] {
  const result: unknown[] = [];
  let offset = 0;

  for (let i = 0; i < rows; i++) {
    const { value: jsonLen, newOffset } = decodeVarint(data, offset);
    offset = newOffset;
    const jsonBytes = data.subarray(offset, offset + jsonLen);
    const json = utf8Decode(jsonBytes);
    result.push(JSON.parse(json));
    offset += jsonLen;
  }

  return result;
}
