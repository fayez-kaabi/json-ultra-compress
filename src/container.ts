import type { ContainerHeader } from './types.js';
import { assert, concatUint8, readU32LE, utf8Decode, utf8Encode, writeU32LE } from './utils.js';
// Simple CRC32 implementation
function crc32(data: Uint8Array): number {
  const table = new Uint32Array(256);

  // Generate CRC table
  for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 8; j > 0; j--) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320;
      } else {
        crc >>>= 1;
      }
    }
    table[i] = crc;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0; // Ensure unsigned 32-bit
}

const MAGIC = utf8Encode('JCO1');

export function encodeContainer(header: ContainerHeader, body: Uint8Array): Uint8Array {
  const headerJson = JSON.stringify(header);
  const headerBytes = utf8Encode(headerJson);
  const headerLen = writeU32LE(headerBytes.byteLength);

  // Calculate CRC32 over the body only
  const bodyCrc = crc32(body);
  const crcBytes = writeU32LE(bodyCrc);

  return concatUint8([MAGIC, headerLen, headerBytes, crcBytes, body]);
}

export function decodeContainer(bytes: Uint8Array): { header: ContainerHeader; body: Uint8Array } {
  assert(bytes.byteLength >= 12, 'Invalid container: too short'); // Need space for magic + headerLen + CRC
  assert(bytes[0] === MAGIC[0] && bytes[1] === MAGIC[1] && bytes[2] === MAGIC[2] && bytes[3] === MAGIC[3],
    'Invalid container: bad magic');
  const headerLen = readU32LE(bytes.subarray(4, 8));
  const headerStart = 8;
  const headerEnd = headerStart + headerLen;
  assert(headerEnd + 4 <= bytes.byteLength, 'Invalid container: header length');
  const headerJson = utf8Decode(bytes.subarray(headerStart, headerEnd));
  const header = JSON.parse(headerJson) as ContainerHeader;
  assert(header.version === 1, 'Unsupported container version');

  // Read CRC and body
  const storedCrc = readU32LE(bytes.subarray(headerEnd, headerEnd + 4));
  const body = bytes.subarray(headerEnd + 4);

  // Verify CRC32
  const actualCrc = crc32(body);
  if (storedCrc !== actualCrc) {
    throw new Error(`CRC mismatch: expected ${storedCrc}, got ${actualCrc}`);
  }

  return { header, body };
}


