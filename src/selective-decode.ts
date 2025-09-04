// Selective decode implementation for columnar NDJSON
import { utf8Decode } from './utils.js';
import type { Bitset, ColumnReader, Window, ColumnarHandle } from './types.js';

// Bitset implementation for line presence
class BitsetImpl implements Bitset {
  public length: number;

  constructor(private data: Uint8Array, length: number) {
    this.length = length;
  }

  get(i: number): boolean {
    if (i >= this.length) return false;
    const byteIdx = Math.floor(i / 8);
    const bitIdx = i % 8;
    return (this.data[byteIdx] >> bitIdx) & 1 ? true : false;
  }
}

// Column type encodings (matching columnar.ts)
enum ColumnType {
  INT_VARINT = 0,
  DELTA_ZIGZAG = 1,
  TIME_DOD = 2,
  BOOL_RLE = 3,
  ENUM_IDS = 4,
  STR_IDS_WITH_RESID = 5,
  RAW_JSON = 6
}

// Varint decoding utilities
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

function zigzagDecode(n: number): number {
  return (n & 1) ? -((n + 1) >> 1) : (n >> 1);
}

// ColumnReader implementations using the same decoding logic as columnar.ts
class SimpleColumnReader implements ColumnReader {
  private values: unknown[] = [];
  private decoded = false;

  constructor(
    private data: Uint8Array,
    private presence: Uint8Array,
    private keyIndex: number,
    private totalRows: number,
    private keyCount: number
  ) {}

  present(i: number): boolean {
    if (i >= this.totalRows) return false;
    const bitIdx = i * this.keyCount + this.keyIndex;
    const byteIdx = Math.floor(bitIdx / 8);
    const bit = (this.presence[byteIdx] >> (bitIdx % 8)) & 1;
    return bit === 1;
  }

  next(): any {
    throw new Error('next() is deprecated - use getValue(index) instead');
  }

  getValue(i: number): any {
    this.ensureDecoded();
    return i < this.values.length ? this.values[i] : null;
  }

  private ensureDecoded() {
    if (this.decoded) return;

    // Use the same decoding logic as the original columnar implementation
    this.values = decodeColumn(this.data, this.totalRows);
    this.decoded = true;
  }
}

// Decode column function (copied from columnar.ts)
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

// Window implementation
class WindowImpl implements Window {
  public numRows: number;
  public linePresence?: Bitset;
  public keyOrder: string[];
  private readers: Map<string, ColumnReader> = new Map();

  constructor(
    numRows: number,
    keyOrder: string[],
    presence: Uint8Array,
    columns: Uint8Array[],
    linePresence?: Bitset
  ) {
    this.numRows = numRows;
    this.keyOrder = keyOrder;
    this.linePresence = linePresence;

    // Create column readers
    for (let i = 0; i < keyOrder.length; i++) {
      const key = keyOrder[i];
      const columnData = columns[i];
      const reader = new SimpleColumnReader(columnData, presence, i, numRows, keyOrder.length);
      this.readers.set(key, reader);
    }
  }

  getReader(field: string): ColumnReader | null {
    return this.readers.get(field) || null;
  }
}

export function openColumnar(payload: Uint8Array): ColumnarHandle {
  const frames = parseColumnarFrames(payload);
  const windows: Window[] = [];
  const keySet = new Set<string>();

  let linePresence: Bitset | undefined;

  for (const frame of frames) {
    // Check if this is a line presence bitmap
    if (frame.length >= 2 && frame[0] === 0x42 && frame[1] === 0x4D) {
      linePresence = parseLinePresenceBitmap(frame);
      continue;
    }

    // Parse columnar frame
    const window = parseColumnarFrame(frame, linePresence);
    if (window) {
      windows.push(window);
      // Add keys to the global key set
      for (const key of window.keyOrder) {
        keySet.add(key);
      }
    }
  }

  return { windows, keySet };
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

function parseLinePresenceBitmap(frame: Uint8Array): Bitset {
  if (frame.length < 6 || frame[0] !== 0x42 || frame[1] !== 0x4D) {
    throw new Error('Invalid line presence bitmap');
  }

  const dv = new DataView(frame.buffer, frame.byteOffset);
  const lineCount = dv.getUint32(2, true);
  const bitmapBytes = Math.ceil(lineCount / 8);

  if (frame.length < 6 + bitmapBytes) {
    throw new Error('Incomplete line presence bitmap');
  }

  const bitmapData = frame.subarray(6, 6 + bitmapBytes);
  return new BitsetImpl(bitmapData, lineCount);
}

function parseColumnarFrame(frame: Uint8Array, linePresence?: Bitset): Window | null {
  if (frame.length < 15) return null; // Minimum size for header

  const dv = new DataView(frame.buffer, frame.byteOffset);
  let offset = 0;

  const magic = frame[offset++];
  if (magic !== 0xC1) return null;

  const rows = dv.getUint32(offset, true); offset += 4;
  const shapeId = dv.getBigUint64(offset, true); offset += 8;
  const keyCount = dv.getUint16(offset, true); offset += 2;

  if (rows === 0) return null;

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

  // Read columns
  const columns: Uint8Array[] = [];
  for (let i = 0; i < keyCount; i++) {
    const colLen = dv.getUint32(offset, true); offset += 4;
    const colBytes = frame.subarray(offset, offset + colLen);
    columns.push(colBytes);
    offset += colLen;
  }

  return new WindowImpl(rows, keys, presence, columns, linePresence);
}

export function isColumnarPayload(buf: Uint8Array): boolean {
  if (buf.length < 1) return false;

  // Check for columnar frame magic (0xC1) or bitmap magic ('BM')
  return buf[0] === 0xC1 || (buf.length >= 2 && buf[0] === 0x42 && buf[1] === 0x4D);
}
